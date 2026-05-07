import json
import os
import joblib
import numpy as np
import pandas as pd

from sklearn.base import clone
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

import lightgbm as lgb
import xgboost as xgb


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "../data/real")
MODELS_DIR = os.path.join(SCRIPT_DIR, "../models")

BASE_MODEL_ORDER = ["rf", "xgb", "lgb", "et", "mlp"]


def find_dataset_file(candidates):
    for name in candidates:
        path = os.path.join(DATA_DIR, name)
        if os.path.exists(path):
            return path
    return None


def build_label_mapping(series):
    if pd.api.types.is_numeric_dtype(series):
        return None

    values = series.astype(str).str.strip().str.lower()
    return {
        "normal": 0,
        "benign": 0,
        "0": 0,
        "attack": 1,
        "anomaly": 1,
        "malicious": 1,
        "1": 1,
    }, values


def encode_categorical(train_df, test_df, categorical_cols):
    mappings = {}
    for col in categorical_cols:
        train_vals = train_df[col].astype(str).fillna("<MISSING>")
        test_vals = test_df[col].astype(str).fillna("<MISSING>")

        unique_vals = pd.Index(train_vals.unique()).sort_values()
        mapping = {val: idx for idx, val in enumerate(unique_vals)}

        train_df[col] = train_vals.map(mapping).fillna(-1).astype(np.int32)
        test_df[col] = test_vals.map(mapping).fillna(-1).astype(np.int32)
        mappings[col] = mapping

    return mappings


def ece_score(y_true, y_prob, bins=15):
    total = len(y_true)
    ece = 0.0
    for i in range(bins):
        lo = i / bins
        hi = (i + 1) / bins
        if i == bins - 1:
            mask = (y_prob >= lo) & (y_prob <= hi)
        else:
            mask = (y_prob >= lo) & (y_prob < hi)

        if not np.any(mask):
            continue

        conf = y_prob[mask].mean()
        acc = y_true[mask].mean()
        ece += abs(conf - acc) * (mask.sum() / total)

    return float(ece)


def temperature_transform(probabilities, temperature):
    probabilities = np.clip(probabilities, 1e-6, 1 - 1e-6)
    logits = np.log(probabilities / (1 - probabilities))
    scaled = 1.0 / (1.0 + np.exp(-(logits / temperature)))
    return np.clip(scaled, 0.0, 1.0)


def calibration_score(y_true, probs):
    brier = float(np.mean((probs - y_true) ** 2))
    ece = ece_score(y_true, probs, bins=15)
    extreme_share = float((probs <= 0.05).mean() + (probs >= 0.95).mean())
    # Combine calibration quality and a stronger interpretability penalty.
    total = brier + (0.5 * ece) + (0.20 * extreme_share)
    return {
        "score": float(total),
        "brier": brier,
        "ece15": ece,
        "extreme_share": extreme_share,
    }


def build_base_model_templates():
    return {
        "rf": RandomForestClassifier(
            n_estimators=100,
            max_depth=14,
            min_samples_split=8,
            min_samples_leaf=3,
            class_weight="balanced",
            n_jobs=-1,
            random_state=42,
        ),
        "xgb": xgb.XGBClassifier(
            objective="binary:logistic",
            eval_metric="logloss",
            n_estimators=130,
            max_depth=6,
            learning_rate=0.08,
            subsample=0.8,
            colsample_bytree=0.8,
            n_jobs=-1,
            random_state=42,
        ),
        "lgb": lgb.LGBMClassifier(
            objective="binary",
            n_estimators=130,
            num_leaves=31,
            learning_rate=0.08,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbose=-1,
        ),
        "et": ExtraTreesClassifier(
            n_estimators=100,
            max_depth=14,
            min_samples_split=8,
            min_samples_leaf=3,
            class_weight="balanced",
            n_jobs=-1,
            random_state=42,
        ),
        "mlp": MLPClassifier(
            hidden_layer_sizes=(64, 32),
            activation="relu",
            solver="adam",
            alpha=0.001,
            batch_size=256,
            learning_rate="adaptive",
            max_iter=120,
            early_stopping=True,
            random_state=42,
        ),
    }


def evaluate_probabilities(y_true, probs, threshold=0.5):
    preds = (probs >= threshold).astype(int)
    return {
        "accuracy": float(accuracy_score(y_true, preds)),
        "confusion_matrix": confusion_matrix(y_true, preds).tolist(),
        "report": classification_report(y_true, preds, output_dict=True),
        "ece15": ece_score(y_true, probs, bins=15),
        "brier": float(np.mean((probs - y_true) ** 2)),
        "extreme_low<=0.05": float((probs <= 0.05).mean()),
        "extreme_high>=0.95": float((probs >= 0.95).mean()),
    }


def main():
    print("Loading UNSW-NB15 train and test files...")

    train_path = find_dataset_file([
        "unsw_train.csv",
        "UNSW_NB15_training-set.csv",
        "unswtrain.csv",
    ])
    test_path = find_dataset_file([
        "unsw_test.csv",
        "UNSW_NB15_testing-set.csv",
        "unswtest.csv",
    ])

    if not train_path or not test_path:
        print("Error: Could not find UNSW train/test files in data/real")
        return 1

    print(f"Train file: {train_path}")
    print(f"Test file: {test_path}")

    train_df = pd.read_csv(train_path)
    test_df = pd.read_csv(test_path)

    train_df.columns = [c.strip() for c in train_df.columns]
    test_df.columns = [c.strip() for c in test_df.columns]

    print(f"Train shape: {train_df.shape}")
    print(f"Test shape: {test_df.shape}")

    if "label" not in train_df.columns or "label" not in test_df.columns:
        print("Error: Expected 'label' column in both UNSW files")
        return 1

    drop_cols = {"label", "attack_cat", "id"}
    feature_cols = [c for c in train_df.columns if c not in drop_cols]

    missing_in_test = [c for c in feature_cols if c not in test_df.columns]
    if missing_in_test:
        print(f"Error: Missing columns in test set: {missing_in_test}")
        return 1

    X_train_full = train_df[feature_cols].copy()
    X_test = test_df[feature_cols].copy()

    y_train_full = train_df["label"].copy()
    y_test = test_df["label"].copy()

    label_mapping_result = build_label_mapping(y_train_full)
    if label_mapping_result is not None:
        mapping, y_train_text = label_mapping_result
        y_test_text = y_test.astype(str).str.strip().str.lower()
        y_train_full = y_train_text.map(mapping)
        y_test = y_test_text.map(mapping)

    y_train_full = pd.to_numeric(y_train_full, errors="coerce")
    y_test = pd.to_numeric(y_test, errors="coerce")

    if y_train_full.isna().any() or y_test.isna().any():
        print("Error: Could not map all label values to binary classes")
        return 1

    y_train_full = y_train_full.astype(np.int32).values
    y_test = y_test.astype(np.int32).values

    print("Label distribution (train):")
    print(pd.Series(y_train_full).value_counts().sort_index())
    print("Label distribution (test):")
    print(pd.Series(y_test).value_counts().sort_index())

    categorical_cols = X_train_full.select_dtypes(include=["object", "category"]).columns.tolist()
    print(f"Categorical columns: {categorical_cols}")

    cat_mappings = encode_categorical(X_train_full, X_test, categorical_cols)

    for col in feature_cols:
        X_train_full[col] = pd.to_numeric(X_train_full[col], errors="coerce")
        X_test[col] = pd.to_numeric(X_test[col], errors="coerce")

    medians = X_train_full.median(numeric_only=True)
    X_train_full = X_train_full.fillna(medians)
    X_test = X_test.fillna(medians)

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_full)
    X_test_scaled = scaler.transform(X_test)

    # Hold out a calibration set from train for probability calibration only.
    X_dev, X_calib, y_dev, y_calib = train_test_split(
        X_train_scaled,
        y_train_full,
        test_size=0.2,
        random_state=42,
        stratify=y_train_full,
    )

    print(f"Development samples: {len(X_dev)}")
    print(f"Calibration samples: {len(X_calib)}")

    model_templates = build_base_model_templates()
    trained_models = {}

    oof_meta_features = np.zeros((len(X_dev), len(BASE_MODEL_ORDER)), dtype=np.float64)
    calib_meta_features = np.zeros((len(X_calib), len(BASE_MODEL_ORDER)), dtype=np.float64)
    test_meta_features = np.zeros((len(X_test_scaled), len(BASE_MODEL_ORDER)), dtype=np.float64)

    test_metrics = {}
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    print("Training base models with out-of-fold stacking...")
    for col_idx, model_name in enumerate(BASE_MODEL_ORDER):
        template = model_templates[model_name]
        print(f"- OOF training {model_name.upper()}...")

        for fold_idx, (tr_idx, va_idx) in enumerate(cv.split(X_dev, y_dev), start=1):
            fold_model = clone(template)
            fold_model.fit(X_dev[tr_idx], y_dev[tr_idx])
            fold_proba = fold_model.predict_proba(X_dev[va_idx])[:, 1]
            oof_meta_features[va_idx, col_idx] = fold_proba
            print(f"  fold {fold_idx}: done")

        # Fit final model on full development split for inference
        final_model = clone(template)
        final_model.fit(X_dev, y_dev)
        trained_models[model_name] = final_model

        calib_proba = final_model.predict_proba(X_calib)[:, 1]
        test_proba = final_model.predict_proba(X_test_scaled)[:, 1]

        calib_meta_features[:, col_idx] = calib_proba
        test_meta_features[:, col_idx] = test_proba

        test_metrics[model_name] = {
            "accuracy": float(accuracy_score(y_test, (test_proba >= 0.5).astype(int))),
            "confusion_matrix": confusion_matrix(y_test, (test_proba >= 0.5).astype(int)).tolist(),
        }
        print(f"  {model_name.upper()} test accuracy: {test_metrics[model_name]['accuracy']:.4f}")

    # Logistic meta-model for smoother probability behavior than tree meta-models.
    meta_classifier = LogisticRegression(max_iter=2000, random_state=42)
    print("Training logistic meta-classifier on OOF predictions...")
    meta_classifier.fit(oof_meta_features, y_dev)

    calib_raw_proba = meta_classifier.predict_proba(calib_meta_features)[:, 1]
    test_raw_proba = meta_classifier.predict_proba(test_meta_features)[:, 1]

    # Fit calibrators on dedicated calibration split.
    platt = LogisticRegression(max_iter=1000, random_state=42)
    platt.fit(calib_raw_proba.reshape(-1, 1), y_calib)
    calib_platt = platt.predict_proba(calib_raw_proba.reshape(-1, 1))[:, 1]

    isotonic = IsotonicRegression(out_of_bounds="clip")
    isotonic.fit(calib_raw_proba, y_calib)
    calib_isotonic = isotonic.transform(calib_raw_proba)

    # Temperature scaling search for smoother probabilities.
    temperature_candidates = [1.0, 1.2, 1.5, 2.0, 2.5, 3.0]
    best_temp = 1.0
    best_temp_eval = None
    best_temp_probs = None
    for t in temperature_candidates:
        temp_probs = temperature_transform(calib_raw_proba, t)
        temp_eval = calibration_score(y_calib, temp_probs)
        if best_temp_eval is None or temp_eval["score"] < best_temp_eval["score"]:
            best_temp = t
            best_temp_eval = temp_eval
            best_temp_probs = temp_probs

    platt_eval = calibration_score(y_calib, calib_platt)
    isotonic_eval = calibration_score(y_calib, calib_isotonic)

    calibrator_candidates = {
        "platt": {
            "model": platt,
            "calib_eval": platt_eval,
            "test_probs": platt.predict_proba(test_raw_proba.reshape(-1, 1))[:, 1],
        },
        "isotonic": {
            "model": isotonic,
            "calib_eval": isotonic_eval,
            "test_probs": isotonic.transform(test_raw_proba),
        },
        "temperature": {
            "model": {"temperature": best_temp},
            "calib_eval": best_temp_eval,
            "test_probs": temperature_transform(test_raw_proba, best_temp),
        },
    }

    chosen_method = min(
        calibrator_candidates.keys(),
        key=lambda name: calibrator_candidates[name]["calib_eval"]["score"],
    )
    chosen_calibrator = calibrator_candidates[chosen_method]["model"]
    test_calibrated_proba = calibrator_candidates[chosen_method]["test_probs"]

    test_raw_pred = (test_raw_proba >= 0.5).astype(int)
    test_calibrated_pred = (test_calibrated_proba >= 0.5).astype(int)

    raw_accuracy = float(accuracy_score(y_test, test_raw_pred))
    calibrated_accuracy = float(accuracy_score(y_test, test_calibrated_pred))

    print("=" * 60)
    print("UNSW-NB15 Ensemble Test Results")
    print("=" * 60)
    for name in BASE_MODEL_ORDER:
        print(f"{name.upper()} accuracy: {test_metrics[name]['accuracy']:.4f}")
    print(f"ENSEMBLE RAW accuracy: {raw_accuracy:.4f}")
    print(f"ENSEMBLE CALIBRATED ({chosen_method}) accuracy: {calibrated_accuracy:.4f}")

    print("\nCalibrator selection on calibration split:")
    print(
        "  Platt      -> score={:.6f}, brier={:.6f}, ece15={:.6f}, extreme={:.4f}".format(
            platt_eval["score"], platt_eval["brier"], platt_eval["ece15"], platt_eval["extreme_share"]
        )
    )
    print(
        "  Isotonic   -> score={:.6f}, brier={:.6f}, ece15={:.6f}, extreme={:.4f}".format(
            isotonic_eval["score"], isotonic_eval["brier"], isotonic_eval["ece15"], isotonic_eval["extreme_share"]
        )
    )
    print(
        "  Temperature -> score={:.6f}, brier={:.6f}, ece15={:.6f}, extreme={:.4f}, T={:.2f}".format(
            best_temp_eval["score"],
            best_temp_eval["brier"],
            best_temp_eval["ece15"],
            best_temp_eval["extreme_share"],
            best_temp,
        )
    )

    print("\nCalibrated test classification report:")
    print(classification_report(y_test, test_calibrated_pred, target_names=["Normal", "Attack"]))

    os.makedirs(MODELS_DIR, exist_ok=True)

    joblib.dump(trained_models["rf"], os.path.join(MODELS_DIR, "unsw_rf_model.pkl"))
    joblib.dump(trained_models["xgb"], os.path.join(MODELS_DIR, "unsw_xgb_model.pkl"))
    joblib.dump(trained_models["lgb"], os.path.join(MODELS_DIR, "unsw_lgb_model.pkl"))
    joblib.dump(trained_models["et"], os.path.join(MODELS_DIR, "unsw_et_model.pkl"))
    joblib.dump(trained_models["mlp"], os.path.join(MODELS_DIR, "unsw_mlp_model.pkl"))
    joblib.dump(meta_classifier, os.path.join(MODELS_DIR, "unsw_meta_model.pkl"))

    calibrator_payload = {
        "method": chosen_method,
        "model": chosen_calibrator,
        "platt_eval": platt_eval,
        "isotonic_eval": isotonic_eval,
        "temperature_eval": best_temp_eval,
    }
    joblib.dump(calibrator_payload, os.path.join(MODELS_DIR, "unsw_probability_calibrator.pkl"))

    joblib.dump(scaler, os.path.join(MODELS_DIR, "unsw_scaler.pkl"))
    joblib.dump(feature_cols, os.path.join(MODELS_DIR, "unsw_feature_names.pkl"))
    joblib.dump(cat_mappings, os.path.join(MODELS_DIR, "unsw_categorical_mappings.pkl"))

    metrics_payload = {
        "train_shape": train_df.shape,
        "test_shape": test_df.shape,
        "feature_count": len(feature_cols),
        "categorical_columns": categorical_cols,
        "stacking": {
            "base_model_order": BASE_MODEL_ORDER,
            "meta_model": "LogisticRegression",
            "oof_folds": 5,
            "calibration_split": 0.2,
        },
        "calibration": {
            "selected_method": chosen_method,
            "platt_eval": platt_eval,
            "isotonic_eval": isotonic_eval,
            "temperature_eval": best_temp_eval,
            "temperature": best_temp,
        },
        "base_model_metrics": test_metrics,
        "ensemble_raw": evaluate_probabilities(y_test, test_raw_proba),
        "ensemble_calibrated": evaluate_probabilities(y_test, test_calibrated_proba),
    }

    metrics_path = os.path.join(MODELS_DIR, "unsw_metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics_payload, f, indent=2)

    print("Saved UNSW artifacts:")
    print(f"- {metrics_path}")
    print("- unsw_probability_calibrator.pkl")
    print("- unsw_* model files in models folder")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
