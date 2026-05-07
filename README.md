# Network Intrusion Detection System

An AI-powered network intrusion detection system with machine learning capabilities and a modern web interface.

Current active dataset/profile: UNSW-NB15.

## Features

- **Machine Learning Model**: Random Forest classifier trained on synthetic network traffic data
- **Real-time Detection**: REST API for instant threat analysis
- **Interactive Dashboard**: Modern web interface with real-time statistics
- **Batch Processing**: Analyze multiple network samples simultaneously
- **Threat Classification**: High/Medium/Low threat level assessment
- **Activity History**: Track recent predictions and system activity

## Architecture

```
├── backend/           # Flask REST API
│   └── app.py        # Main API server
├── frontend/         # React web dashboard (Vite)
│   ├── src/         # React components and styles
│   └── package.json # Frontend dependencies/scripts
├── models/           # Trained ML models
├── data/            # Training datasets
├── scripts/         # Training and utility scripts
└── requirements.txt # Python dependencies
```

## Quick Start

### 1. Install Dependencies
```bash
install.bat
```

This creates and uses .venv automatically. No PowerShell activation is required.

### 2. Train the Model
```bash
train.bat
```

### 3. Start the System
```bash
# Terminal 1: Start Backend
start_backend.bat

# Terminal 2: Open Frontend
start_frontend.bat
```

Frontend URL: http://localhost:5173

## API Endpoints

### Health Check
```http
GET /health
```

### Single Prediction
```http
POST /predict
Content-Type: application/json

{
  "features": [0.5, 1.2, 0.3, ...]  // provide exactly model-info.feature_count values
}
```

### Batch Prediction
```http
POST /predict-batch
Content-Type: application/json

{
  "records": [
    {"id": 1, "features": [0.5, 1.2, 0.3, ...]},
    {"id": 2, "features": [1.0, 0.8, 0.1, ...]}
  ]
}
```

### Model Information
```http
GET /model-info
```

## Model Performance

Use `GET /model-info` for active profile details and `models/unsw_metrics.json` for the latest UNSW evaluation metrics.

## Network Features

The active UNSW-NB15 model uses 42 input features.

## Threat Levels

- **LOW**: < 40% attack probability
- **MEDIUM**: 40-70% attack probability
- **HIGH**: > 70% attack probability

## Technologies Used

- **Backend**: Python Flask, scikit-learn, joblib
- **Frontend**: React.js, Recharts, Vite
- **ML Model**: Random Forest Classifier
- **Data Processing**: pandas, numpy

## Development

### Training a New Model
```python
.venv\Scripts\python.exe scripts/train_ensemble_unsw_nb15.py
```

### PowerShell Start (without activation)
```powershell
& ".\.venv\Scripts\python.exe" .\backend\app.py
```

### Modifying the API
Edit `backend/app.py` and restart the server.

### Updating the Frontend
Edit `frontend/src/App.jsx` for UI changes.

## Security Considerations

- Input validation on all API endpoints
- CORS enabled for cross-origin requests
- Model predictions are probabilistic, not definitive
- Regular model retraining recommended for production use

## License

This project is for educational and research purposes.