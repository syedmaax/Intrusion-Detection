from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
import os
import json
import sys

app = Flask(__name__)
CORS(app)

# Load trained models
import os
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, '../models')

# Model components
models = {}
scaler = None
feature_names = None
ensemble_metadata = None
categorical_mappings = {}
probability_calibrator = None
calibration_method = 'none'
active_profile = 'unknown'
sample_source_path = None
sample_cache_df = None

def _first_existing_path(candidates):
    for candidate in candidates:
        path = os.path.join(MODELS_DIR, candidate)
        if os.path.exists(path):
            return path
    return None


def _first_existing_data_path(candidates):
    for candidate in candidates:
        path = os.path.join(BASE_DIR, candidate)
        if os.path.exists(path):
            return path
    return None


def load_models():
    global models, scaler, feature_names, ensemble_metadata
    global categorical_mappings, probability_calibrator, calibration_method
    global active_profile, sample_source_path, sample_cache_df

    try:
        requested_profile = os.getenv('IDS_MODEL_PROFILE', 'auto').strip().lower()
        profiles = {
            'unsw': {
                'name': 'unsw-nb15',
                'model_type': 'UNSW-NB15 Ensemble',
                'model_file_candidates': {
                    'rf': ['unsw_rf_model.pkl'],
                    'xgb': ['unsw_xgb_model.pkl'],
                    'lgb': ['unsw_lgb_model.pkl'],
                    'et': ['unsw_et_model.pkl'],
                    'mlp': ['unsw_mlp_model.pkl'],
                    'meta': ['unsw_meta_model.pkl'],
                },
                'scaler_candidates': ['unsw_scaler.pkl'],
                'feature_candidates': ['unsw_feature_names.pkl'],
                'metadata_candidates': ['unsw_metrics.json'],
                'categorical_mapping_candidates': ['unsw_categorical_mappings.pkl'],
                'calibrator_candidates': ['unsw_probability_calibrator.pkl'],
                'sample_candidates': ['../data/real/unsw_test.csv', '../data/real/unsw_train.csv'],
            },
            'nsl': {
                'name': 'nsl-kdd',
                'model_type': 'Regularized Ensemble (Anti-Overfitting)',
                'model_file_candidates': {
                    'rf': ['rf_regularized_model.pkl', 'rf_advanced_model.pkl'],
                    'xgb': ['xgb_regularized_model.pkl', 'xgb_advanced_model.pkl'],
                    'lgb': ['lgb_regularized_model.pkl', 'lgb_advanced_model.pkl'],
                    'et': ['et_regularized_model.pkl', 'et_advanced_model.pkl'],
                    'mlp': ['mlp_regularized_model.pkl', 'mlp_advanced_model.pkl'],
                    'meta': ['ensemble_regularized_meta.pkl', 'ensemble_meta_classifier.pkl']
                },
                'scaler_candidates': ['scaler_regularized.pkl', 'scaler.pkl'],
                'feature_candidates': ['feature_names_regularized.pkl', 'feature_names.pkl'],
                'metadata_candidates': ['ensemble_regularized_metadata.pkl', 'ensemble_metadata.pkl'],
                'categorical_mapping_candidates': [],
                'calibrator_candidates': [],
                'sample_candidates': ['../data/real/KDDTest+_realistic.csv', '../data/real/KDDTrain+_realistic.csv'],
            }
        }

        if requested_profile == 'unsw':
            profile_order = ['unsw']
        elif requested_profile == 'nsl':
            profile_order = ['nsl']
        else:
            # Auto mode prefers UNSW if present.
            profile_order = ['unsw', 'nsl']

        selected = None
        selected_cfg = None
        for profile_key in profile_order:
            cfg = profiles[profile_key]
            feature_path = _first_existing_path(cfg['feature_candidates'])
            scaler_path = _first_existing_path(cfg['scaler_candidates'])
            has_any_model = any(_first_existing_path(candidates) for candidates in cfg['model_file_candidates'].values())
            if feature_path and scaler_path and has_any_model:
                selected = profile_key
                selected_cfg = cfg
                break

        if not selected:
            print('❌ No compatible model profile found. Train models first.')
            return False

        active_profile = selected_cfg['name']
        models = {}
        scaler = None
        feature_names = None
        ensemble_metadata = None
        categorical_mappings = {}
        probability_calibrator = None
        calibration_method = 'none'
        sample_cache_df = None

        print(f"🔎 Active model profile: {active_profile}")

        for model_key, candidates in selected_cfg['model_file_candidates'].items():
            chosen_path = _first_existing_path(candidates)
            if chosen_path:
                models[model_key] = joblib.load(chosen_path)
                print("✅ Loaded {} model from {}".format(model_key.upper(), os.path.basename(chosen_path)))
            else:
                print("⚠️  {} model not found in expected files: {}".format(model_key.upper(), ', '.join(candidates)))

        scaler_path = _first_existing_path(selected_cfg['scaler_candidates'])
        if scaler_path:
            scaler = joblib.load(scaler_path)
            print("✅ Loaded scaler from {}".format(os.path.basename(scaler_path)))

        feature_names_path = _first_existing_path(selected_cfg['feature_candidates'])
        if feature_names_path:
            feature_names = joblib.load(feature_names_path)
            print("✅ Loaded feature names from {}".format(os.path.basename(feature_names_path)))

        metadata_path = _first_existing_path(selected_cfg['metadata_candidates'])
        if metadata_path:
            if metadata_path.endswith('.json'):
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    ensemble_metadata = json.load(f)
            else:
                ensemble_metadata = joblib.load(metadata_path)
            print("✅ Loaded ensemble metadata from {}".format(os.path.basename(metadata_path)))

        categorical_mapping_path = _first_existing_path(selected_cfg['categorical_mapping_candidates'])
        if categorical_mapping_path:
            categorical_mappings = joblib.load(categorical_mapping_path)
            print("✅ Loaded categorical mappings from {}".format(os.path.basename(categorical_mapping_path)))

        calibrator_path = _first_existing_path(selected_cfg['calibrator_candidates'])
        if calibrator_path:
            calibrator_payload = joblib.load(calibrator_path)
            if isinstance(calibrator_payload, dict):
                probability_calibrator = calibrator_payload.get('model')
                calibration_method = calibrator_payload.get('method', 'none')
            else:
                probability_calibrator = calibrator_payload
                calibration_method = 'custom'
            print("✅ Loaded probability calibrator from {} (method={})".format(os.path.basename(calibrator_path), calibration_method))

        sample_source_path = _first_existing_data_path(selected_cfg['sample_candidates'])
        if sample_source_path:
            print("✅ Sample source set to {}".format(sample_source_path))

        if not models or not scaler or not feature_names:
            print("❌ Model profile incomplete (models/scaler/feature names missing).")
            return False

        print("🎉 Ensemble models loaded successfully!")
        return True

    except Exception as e:
        print(f"❌ Error loading models: {str(e)}")
        return False

# Load models on startup
model_loaded = load_models()


def prepare_features(raw_features):
    expected_count = len(feature_names) if feature_names is not None else None
    arr = np.array(raw_features, dtype=np.float64).reshape(1, -1)

    if expected_count is not None and arr.shape[1] != expected_count:
        raise ValueError(f"Feature count mismatch for {active_profile}: expected {expected_count}, got {arr.shape[1]}")

    if scaler:
        arr = scaler.transform(arr)

    return arr


def apply_probability_calibration(raw_probability):
    if probability_calibrator is None:
        return float(np.clip(raw_probability, 0.0, 1.0))

    raw_probability = float(np.clip(raw_probability, 0.0, 1.0))

    try:
        if calibration_method == 'platt' and hasattr(probability_calibrator, 'predict_proba'):
            calibrated = probability_calibrator.predict_proba(np.array([[raw_probability]]))[:, 1][0]
            return float(np.clip(calibrated, 0.0, 1.0))

        if calibration_method == 'isotonic' and hasattr(probability_calibrator, 'transform'):
            calibrated = probability_calibrator.transform(np.array([raw_probability]))[0]
            return float(np.clip(calibrated, 0.0, 1.0))

        if calibration_method == 'temperature' and isinstance(probability_calibrator, dict):
            temperature = float(probability_calibrator.get('temperature', 1.0))
            temperature = max(1e-6, temperature)
            raw_probability = float(np.clip(raw_probability, 1e-6, 1 - 1e-6))
            logit = np.log(raw_probability / (1 - raw_probability))
            calibrated = 1.0 / (1.0 + np.exp(-(logit / temperature)))
            return float(np.clip(calibrated, 0.0, 1.0))

        # Generic fallback
        if hasattr(probability_calibrator, 'predict_proba'):
            calibrated = probability_calibrator.predict_proba(np.array([[raw_probability]]))[:, 1][0]
            return float(np.clip(calibrated, 0.0, 1.0))
        if hasattr(probability_calibrator, 'transform'):
            calibrated = probability_calibrator.transform(np.array([raw_probability]))[0]
            return float(np.clip(calibrated, 0.0, 1.0))
    except Exception:
        # Fail-safe: keep raw probability if calibrator errors.
        return raw_probability

    return raw_probability


def row_to_feature_vector(row):
    values = []
    for col in feature_names:
        value = row[col] if col in row else 0

        if col in categorical_mappings:
            mapping = categorical_mappings[col]
            key = str(value)
            value = mapping.get(key, mapping.get(key.strip(), -1))

        try:
            values.append(float(value))
        except (TypeError, ValueError):
            values.append(0.0)

    return values


def get_sample_rows(size=1):
    global sample_cache_df

    if not sample_source_path:
        raise ValueError('No sample source file configured')

    if sample_cache_df is None:
        sample_cache_df = pd.read_csv(sample_source_path)

    replace = size > len(sample_cache_df)
    return sample_cache_df.sample(n=size, replace=replace, random_state=None)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat(), 'profile': active_profile})

@app.route('/predict', methods=['POST'])
def predict():
    try:
        if not model_loaded:
            return jsonify({'error': 'Models not loaded'}), 500

        data = request.get_json()
        features = prepare_features(data['features'])

        # Get predictions from all individual models
        model_predictions = []
        for model_key in ['rf', 'xgb', 'lgb', 'et', 'mlp']:
            if model_key in models:
                pred_proba = models[model_key].predict_proba(features)[:, 1]
                model_predictions.append(pred_proba[0])

        # Create ensemble features
        ensemble_features = np.array(model_predictions).reshape(1, -1)

        # Get final ensemble prediction
        if 'meta' in models:
            raw_proba = float(models['meta'].predict_proba(ensemble_features)[:, 1][0])
            calibrated_proba = apply_probability_calibration(raw_proba)
            final_proba = np.array([calibrated_proba])
            final_pred = (final_proba > 0.5).astype(int)
        else:
            # Fallback to average of individual models
            raw_proba = float(np.mean(model_predictions))
            calibrated_proba = apply_probability_calibration(raw_proba)
            final_proba = np.array([calibrated_proba])
            final_pred = np.array([int(calibrated_proba > 0.5)])

        # Ensure final_proba is always an array for consistent indexing
        if np.isscalar(final_proba):
            final_proba = np.array([final_proba])
        if np.isscalar(final_pred):
            final_pred = np.array([final_pred])

        native_predictions = [float(x) for x in model_predictions]
        attack_prob = float(final_proba[0])
        normal_prob = float(1 - final_proba[0])
        result = {
            'prediction': int(final_pred[0]),
            'normal_prob': normal_prob,
            'attack_prob': attack_prob,
            'attack_prob_raw': raw_proba,
            'calibration_method': calibration_method,
            'threat_level': 'HIGH' if attack_prob > 0.7 else 'MEDIUM' if attack_prob > 0.4 else 'LOW',
            'model_used': active_profile,
            'individual_predictions': native_predictions,
            'timestamp': datetime.now().isoformat()
        }
        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/predict-batch', methods=['POST'])
def predict_batch():
    try:
        if not model_loaded:
            return jsonify({'error': 'Models not loaded'}), 500

        data = request.get_json()
        records = data['records']

        results = []
        for record in records:
            features = prepare_features(record['features'])

            # Get predictions from all individual models
            model_predictions = []
            for model_key in ['rf', 'xgb', 'lgb', 'et', 'mlp']:
                if model_key in models:
                    pred_proba = models[model_key].predict_proba(features)[:, 1]
                    model_predictions.append(pred_proba[0])

            # Create ensemble features
            ensemble_features = np.array(model_predictions).reshape(1, -1)

            # Get final ensemble prediction
            if 'meta' in models:
                raw_proba = float(models['meta'].predict_proba(ensemble_features)[:, 1][0])
                calibrated_proba = apply_probability_calibration(raw_proba)
                final_proba = np.array([calibrated_proba])
                final_pred = (final_proba > 0.5).astype(int)
            else:
                # Fallback to average of individual models
                raw_proba = float(np.mean(model_predictions))
                calibrated_proba = apply_probability_calibration(raw_proba)
                final_proba = np.array([calibrated_proba])
                final_pred = np.array([int(calibrated_proba > 0.5)])

            # Ensure final_proba is always an array for consistent indexing
            if np.isscalar(final_proba):
                final_proba = np.array([final_proba])
            if np.isscalar(final_pred):
                final_pred = np.array([final_pred])

            native_predictions = [float(x) for x in model_predictions]
            attack_prob = float(final_proba[0])
            normal_prob = float(1 - final_proba[0])
            results.append({
                'id': record.get('id'),
                'prediction': int(final_pred[0]),
                'normal_prob': normal_prob,
                'attack_prob': attack_prob,
                'attack_prob_raw': raw_proba,
                'calibration_method': calibration_method,
                'threat_level': 'HIGH' if attack_prob > 0.7 else 'MEDIUM' if attack_prob > 0.4 else 'LOW',
                'individual_predictions': native_predictions
            })

        return jsonify({'results': results, 'model_used': active_profile})

    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/sample-features', methods=['GET'])
def sample_features():
    try:
        sample_row = get_sample_rows(size=1).iloc[0]
        payload = {
            'features': row_to_feature_vector(sample_row),
            'expected_feature_count': len(feature_names) if feature_names else None,
            'profile': active_profile,
        }

        if 'label' in sample_row:
            payload['true_label'] = int(sample_row['label'])
        if 'attack_cat' in sample_row:
            payload['attack_cat'] = str(sample_row['attack_cat'])

        return jsonify(payload)
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/sample-batch', methods=['GET'])
def sample_batch():
    try:
        size = int(request.args.get('size', 10))
        size = max(1, min(size, 200))
        sampled = get_sample_rows(size=size)

        records = []
        for idx, (_, row) in enumerate(sampled.iterrows(), start=1):
            records.append({
                'id': idx,
                'features': row_to_feature_vector(row),
                'true_label': int(row['label']) if 'label' in row else None,
                'attack_cat': str(row['attack_cat']) if 'attack_cat' in row else None,
            })

        return jsonify({
            'profile': active_profile,
            'expected_feature_count': len(feature_names) if feature_names else None,
            'records': records,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/model-info', methods=['GET'])
def model_info():
    if model_loaded and models:
        return jsonify({
            'model_type': active_profile,
            'model_loaded': True,
            'feature_count': len(feature_names) if feature_names else None,
            'feature_names': [str(f) for f in feature_names] if feature_names is not None else [],
            'algorithms': list(models.keys()),
            'ensemble_method': 'Calibrated Stacking Ensemble',
            'regularization_applied': True,
            'profile': active_profile,
            'calibration_method': calibration_method,
            'calibration_enabled': probability_calibrator is not None,
            'sample_source': os.path.basename(sample_source_path) if sample_source_path else None,
            'anti_overfitting_measures': [
                'Reduced model complexity',
                'Cross-validation used',
                'Proper train/val/test splits',
                'Early stopping applied',
                'L1/L2 regularization'
            ],
            'individual_models': {
                'rf': 'Random Forest (Regularized)',
                'xgb': 'XGBoost (Regularized)',
                'lgb': 'LightGBM (Regularized)',
                'et': 'Extra Trees (Regularized)',
                'mlp': 'Multi-Layer Perceptron (Regularized)',
                'meta': 'Ensemble Meta-Classifier (Regularized)'
            }
        })
    else:
        return jsonify({'model_loaded': False, 'error': 'Models not loaded'}), 404

@app.route('/metrics', methods=['GET'])
def get_metrics():
    if ensemble_metadata:
        return jsonify(ensemble_metadata)
    else:
        try:
            candidates = ['unsw_metrics.json', 'ensemble_regularized_metadata.json']
            for candidate in candidates:
                path = os.path.join(MODELS_DIR, candidate)
                if os.path.exists(path):
                    with open(path, 'r', encoding='utf-8') as f:
                        return jsonify(json.load(f))
        except Exception as e:
            return jsonify({'error': str(e)}), 500
        return jsonify({'error': 'Ensemble metrics not loaded or found'}), 404

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
