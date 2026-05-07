import json
import os

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
MODELS_DIR = os.path.join(BASE_DIR, "models")
DATA_DIR = os.path.join(BASE_DIR, "data", "real")
OUTPUT_DIR = os.path.join(BASE_DIR, "reports", "unsw_evaluation")


MODEL_FILES = {
    "rf": "unsw_rf_model.pkl",
    "xgb": "unsw_xgb_model.pkl",
    "lgb": "unsw_lgb_model.pkl",
    "et": "unsw_et_model.pkl",
    "mlp": "unsw_mlp_model.pkl",
    "meta": "unsw_meta_model.pkl",
}


def load_artifacts():
    models = {}
    for key, filename in MODEL_FILES.items():
        models[key] = joblib.load(os.path.join(MODELS_DIR, filename))

    scaler = joblib.load(os.path.join(MODELS_DIR, "unsw_scaler.pkl"))
    feature_names = joblib.load(os.path.join(MODELS_DIR, "unsw_feature_names.pkl"))
    categorical_mappings = joblib.load(os.path.join(MODELS_DIR, "unsw_categorical_mappings.pkl"))
    calibrator_path = os.path.join(MODELS_DIR, "unsw_probability_calibrator.pkl")
    calibrator_payload = None
    if os.path.exists(calibrator_path):
        calibrator_payload = joblib.load(calibrator_path)

    return models, scaler, feature_names, categorical_mappings, calibrator_payload


def apply_probability_calibration(probabilities, calibrator_payload):
    if calibrator_payload is None:
        return probabilities

    method = "none"
    model = calibrator_payload

    if isinstance(calibrator_payload, dict):
        method = calibrator_payload.get("method", "none")
        model = calibrator_payload.get("model")

    if model is None:
        return probabilities

    probabilities = np.clip(probabilities, 0.0, 1.0)

    if method == "platt" and hasattr(model, "predict_proba"):
        return np.clip(model.predict_proba(probabilities.reshape(-1, 1))[:, 1], 0.0, 1.0)
    if method == "isotonic" and hasattr(model, "transform"):
        return np.clip(model.transform(probabilities), 0.0, 1.0)

    if method == "temperature" and isinstance(model, dict):
        temperature = float(model.get("temperature", 1.0))
        temperature = max(1e-6, temperature)
        p = np.clip(probabilities, 1e-6, 1 - 1e-6)
        logits = np.log(p / (1 - p))
        scaled = 1.0 / (1.0 + np.exp(-(logits / temperature)))
        return np.clip(scaled, 0.0, 1.0)

    if hasattr(model, "predict_proba"):
        return np.clip(model.predict_proba(probabilities.reshape(-1, 1))[:, 1], 0.0, 1.0)
    if hasattr(model, "transform"):
        return np.clip(model.transform(probabilities), 0.0, 1.0)

    return probabilities


def preprocess_dataframe(df, feature_names, categorical_mappings):
    X = df[feature_names].copy()
    y = df["label"].astype(int).values

    for col, mapping in categorical_mappings.items():
        if col in X.columns:
            X[col] = X[col].astype(str).map(mapping).fillna(-1).astype(np.int32)

    for col in X.columns:
        X[col] = pd.to_numeric(X[col], errors="coerce")

    X = X.fillna(X.median(numeric_only=True))
    return X, y


def compute_metrics(y_true, y_pred, y_prob):
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()

    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    fnr = fn / (fn + tp) if (fn + tp) else 0.0
    npv = tn / (tn + fn) if (tn + fn) else 0.0

    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, y_prob)),
        "pr_auc": float(average_precision_score(y_true, y_prob)),
        "brier_score": float(brier_score_loss(y_true, y_prob)),
        "specificity": float(specificity),
        "npv": float(npv),
        "fpr": float(fpr),
        "fnr": float(fnr),
        "confusion_matrix": {
            "tn": int(tn),
            "fp": int(fp),
            "fn": int(fn),
            "tp": int(tp),
        },
    }


def build_predictions(models, X_scaled, calibrator_payload):
    base_probabilities = {}
    for key in ["rf", "xgb", "lgb", "et", "mlp"]:
        base_probabilities[key] = models[key].predict_proba(X_scaled)[:, 1]

    meta_input = np.column_stack([
        base_probabilities["rf"],
        base_probabilities["xgb"],
        base_probabilities["lgb"],
        base_probabilities["et"],
        base_probabilities["mlp"],
    ])
    ensemble_raw_prob = models["meta"].predict_proba(meta_input)[:, 1]
    ensemble_prob = apply_probability_calibration(ensemble_raw_prob, calibrator_payload)

    all_probabilities = dict(base_probabilities)
    all_probabilities["ensemble_raw"] = ensemble_raw_prob
    all_probabilities["ensemble"] = ensemble_prob

    all_predictions = {name: (proba >= 0.5).astype(int) for name, proba in all_probabilities.items()}
    return all_probabilities, all_predictions


def save_json(path, payload):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def plot_confusion_matrices(y_true, predictions, output_path):
    names = ["rf", "xgb", "lgb", "et", "mlp", "ensemble"]
    fig, axes = plt.subplots(2, 3, figsize=(15, 9))
    axes = axes.flatten()

    for i, name in enumerate(names):
        cm = confusion_matrix(y_true, predictions[name])
        ax = axes[i]
        im = ax.imshow(cm, cmap="Blues")
        ax.set_title(f"{name.upper()} Confusion Matrix")
        ax.set_xlabel("Predicted")
        ax.set_ylabel("Actual")
        ax.set_xticks([0, 1])
        ax.set_xticklabels(["Normal", "Attack"])
        ax.set_yticks([0, 1])
        ax.set_yticklabels(["Normal", "Attack"])

        for r in range(2):
            for c in range(2):
                ax.text(c, r, f"{cm[r, c]}", ha="center", va="center", color="black", fontsize=10)

    fig.colorbar(im, ax=axes, fraction=0.02, pad=0.02)
    plt.tight_layout()
    plt.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_roc_curves(y_true, probabilities, output_path):
    plt.figure(figsize=(10, 7))
    for name, proba in probabilities.items():
        fpr, tpr, _ = roc_curve(y_true, proba)
        auc_score = roc_auc_score(y_true, proba)
        plt.plot(fpr, tpr, label=f"{name.upper()} (AUC={auc_score:.4f})")

    plt.plot([0, 1], [0, 1], "k--", linewidth=1)
    plt.title("ROC Curves (UNSW Test Set)")
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.legend(loc="lower right")
    plt.grid(alpha=0.25)
    plt.tight_layout()
    plt.savefig(output_path, dpi=180)
    plt.close()


def plot_pr_curves(y_true, probabilities, output_path):
    plt.figure(figsize=(10, 7))
    for name, proba in probabilities.items():
        precision, recall, _ = precision_recall_curve(y_true, proba)
        ap_score = average_precision_score(y_true, proba)
        plt.plot(recall, precision, label=f"{name.upper()} (AP={ap_score:.4f})")

    plt.title("Precision-Recall Curves (UNSW Test Set)")
    plt.xlabel("Recall")
    plt.ylabel("Precision")
    plt.legend(loc="lower left")
    plt.grid(alpha=0.25)
    plt.tight_layout()
    plt.savefig(output_path, dpi=180)
    plt.close()


def plot_probability_distribution(y_true, ensemble_prob, output_path):
    plt.figure(figsize=(10, 7))
    plt.hist(ensemble_prob[y_true == 0], bins=40, alpha=0.7, label="True Normal (label=0)")
    plt.hist(ensemble_prob[y_true == 1], bins=40, alpha=0.7, label="True Attack (label=1)")
    plt.title("Ensemble Probability Distribution (UNSW Test Set)")
    plt.xlabel("Predicted Attack Probability")
    plt.ylabel("Count")
    plt.legend()
    plt.grid(alpha=0.25)
    plt.tight_layout()
    plt.savefig(output_path, dpi=180)
    plt.close()


def plot_calibration(y_true, ensemble_prob, output_path):
    frac_pos, mean_pred = calibration_curve(y_true, ensemble_prob, n_bins=10, strategy="quantile")

    plt.figure(figsize=(8, 6))
    plt.plot(mean_pred, frac_pos, "o-", label="Ensemble")
    plt.plot([0, 1], [0, 1], "k--", label="Perfect calibration")
    plt.title("Calibration Curve (UNSW Test Set)")
    plt.xlabel("Mean Predicted Probability")
    plt.ylabel("Fraction of Positives")
    plt.legend()
    plt.grid(alpha=0.25)
    plt.tight_layout()
    plt.savefig(output_path, dpi=180)
    plt.close()


def plot_threshold_metrics(y_true, ensemble_prob, output_path):
    thresholds = np.linspace(0.05, 0.95, 19)
    accuracies = []
    precisions = []
    recalls = []
    f1s = []

    for t in thresholds:
        pred = (ensemble_prob >= t).astype(int)
        accuracies.append(accuracy_score(y_true, pred))
        precisions.append(precision_score(y_true, pred, zero_division=0))
        recalls.append(recall_score(y_true, pred, zero_division=0))
        f1s.append(f1_score(y_true, pred, zero_division=0))

    plt.figure(figsize=(10, 7))
    plt.plot(thresholds, accuracies, label="Accuracy")
    plt.plot(thresholds, precisions, label="Precision")
    plt.plot(thresholds, recalls, label="Recall")
    plt.plot(thresholds, f1s, label="F1")
    plt.title("Threshold Trade-off (Ensemble, UNSW Test Set)")
    plt.xlabel("Decision Threshold")
    plt.ylabel("Score")
    plt.ylim(0.0, 1.05)
    plt.legend()
    plt.grid(alpha=0.25)
    plt.tight_layout()
    plt.savefig(output_path, dpi=180)
    plt.close()


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Loading UNSW datasets and model artifacts...")
    train_df = pd.read_csv(os.path.join(DATA_DIR, "unsw_train.csv"))
    test_df = pd.read_csv(os.path.join(DATA_DIR, "unsw_test.csv"))

    models, scaler, feature_names, categorical_mappings, calibrator_payload = load_artifacts()

    X_train, y_train = preprocess_dataframe(train_df, feature_names, categorical_mappings)
    X_test, y_test = preprocess_dataframe(test_df, feature_names, categorical_mappings)

    X_train_scaled = scaler.transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    print("Computing probabilities and predictions...")
    train_probabilities, train_predictions = build_predictions(models, X_train_scaled, calibrator_payload)
    test_probabilities, test_predictions = build_predictions(models, X_test_scaled, calibrator_payload)

    metrics_train = {}
    metrics_test = {}

    for name in ["rf", "xgb", "lgb", "et", "mlp", "ensemble_raw", "ensemble"]:
        metrics_train[name] = compute_metrics(y_train, train_predictions[name], train_probabilities[name])
        metrics_test[name] = compute_metrics(y_test, test_predictions[name], test_probabilities[name])

    # Save JSON metrics
    save_json(os.path.join(OUTPUT_DIR, "metrics_train.json"), metrics_train)
    save_json(os.path.join(OUTPUT_DIR, "metrics_test.json"), metrics_test)

    # Save flat tables for quick reading
    pd.DataFrame(metrics_train).T.to_csv(os.path.join(OUTPUT_DIR, "metrics_train_table.csv"))
    pd.DataFrame(metrics_test).T.to_csv(os.path.join(OUTPUT_DIR, "metrics_test_table.csv"))

    # Save probability quantiles for ensemble (raw and calibrated)
    quantiles = {
        "calibration_method": (calibrator_payload or {}).get("method", "none") if isinstance(calibrator_payload, dict) else "none",
        "train_raw": {
            "q01": float(np.quantile(train_probabilities["ensemble_raw"], 0.01)),
            "q10": float(np.quantile(train_probabilities["ensemble_raw"], 0.10)),
            "q25": float(np.quantile(train_probabilities["ensemble_raw"], 0.25)),
            "q50": float(np.quantile(train_probabilities["ensemble_raw"], 0.50)),
            "q75": float(np.quantile(train_probabilities["ensemble_raw"], 0.75)),
            "q90": float(np.quantile(train_probabilities["ensemble_raw"], 0.90)),
            "q99": float(np.quantile(train_probabilities["ensemble_raw"], 0.99)),
        },
        "train_calibrated": {
            "q01": float(np.quantile(train_probabilities["ensemble"], 0.01)),
            "q10": float(np.quantile(train_probabilities["ensemble"], 0.10)),
            "q25": float(np.quantile(train_probabilities["ensemble"], 0.25)),
            "q50": float(np.quantile(train_probabilities["ensemble"], 0.50)),
            "q75": float(np.quantile(train_probabilities["ensemble"], 0.75)),
            "q90": float(np.quantile(train_probabilities["ensemble"], 0.90)),
            "q99": float(np.quantile(train_probabilities["ensemble"], 0.99)),
        },
        "test_raw": {
            "q01": float(np.quantile(test_probabilities["ensemble_raw"], 0.01)),
            "q10": float(np.quantile(test_probabilities["ensemble_raw"], 0.10)),
            "q25": float(np.quantile(test_probabilities["ensemble_raw"], 0.25)),
            "q50": float(np.quantile(test_probabilities["ensemble_raw"], 0.50)),
            "q75": float(np.quantile(test_probabilities["ensemble_raw"], 0.75)),
            "q90": float(np.quantile(test_probabilities["ensemble_raw"], 0.90)),
            "q99": float(np.quantile(test_probabilities["ensemble_raw"], 0.99)),
        },
        "test_calibrated": {
            "q01": float(np.quantile(test_probabilities["ensemble"], 0.01)),
            "q10": float(np.quantile(test_probabilities["ensemble"], 0.10)),
            "q25": float(np.quantile(test_probabilities["ensemble"], 0.25)),
            "q50": float(np.quantile(test_probabilities["ensemble"], 0.50)),
            "q75": float(np.quantile(test_probabilities["ensemble"], 0.75)),
            "q90": float(np.quantile(test_probabilities["ensemble"], 0.90)),
            "q99": float(np.quantile(test_probabilities["ensemble"], 0.99)),
        },
    }
    save_json(os.path.join(OUTPUT_DIR, "ensemble_probability_quantiles.json"), quantiles)

    print("Generating visual reports...")
    plot_confusion_matrices(y_test, test_predictions, os.path.join(OUTPUT_DIR, "confusion_matrices_test.png"))
    plot_roc_curves(y_test, test_probabilities, os.path.join(OUTPUT_DIR, "roc_curves_test.png"))
    plot_pr_curves(y_test, test_probabilities, os.path.join(OUTPUT_DIR, "precision_recall_curves_test.png"))
    plot_probability_distribution(
        y_test,
        test_probabilities["ensemble"],
        os.path.join(OUTPUT_DIR, "ensemble_probability_distribution_test.png"),
    )
    plot_calibration(
        y_test,
        test_probabilities["ensemble"],
        os.path.join(OUTPUT_DIR, "ensemble_calibration_curve_test.png"),
    )
    plot_threshold_metrics(
        y_test,
        test_probabilities["ensemble"],
        os.path.join(OUTPUT_DIR, "ensemble_threshold_tradeoff_test.png"),
    )

    print("\nEvaluation complete. Outputs saved in:")
    print(OUTPUT_DIR)

    print("\nTop-level ensemble metrics (test):")
    m = metrics_test["ensemble"]
    print(f"  Accuracy   : {m['accuracy']:.4f}")
    print(f"  Precision  : {m['precision']:.4f}")
    print(f"  Recall     : {m['recall']:.4f}")
    print(f"  F1         : {m['f1']:.4f}")
    print(f"  ROC-AUC    : {m['roc_auc']:.4f}")
    print(f"  PR-AUC     : {m['pr_auc']:.4f}")
    print(f"  Brier Score: {m['brier_score']:.4f}")


if __name__ == "__main__":
    main()
