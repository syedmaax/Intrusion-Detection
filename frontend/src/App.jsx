import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const API_URL = 'http://localhost:5000';

const THREAT_COLORS = {
  HIGH: '#ff6173',
  MEDIUM: '#ffb44a',
  LOW: '#2fd39a'
};

const PREDICTION_COLORS = {
  threat: '#ff6173',
  normal: '#2fd39a'
};

const parseFeatures = (text) =>
  text
    .split(/[\s,]+/)
    .map((value) => parseFloat(value.trim()))
    .filter((value) => !Number.isNaN(value));

const generateFeatureVector = (featureCount = 41) =>
  Array.from({ length: featureCount }, () => Number((Math.random() * 10).toFixed(6)));

const logLevelFromEvent = (event) => {
  if (event.includes('failed') || event.includes('error') || event.includes('offline')) return 'high';
  if (event.includes('threat') || event.includes('batch')) return 'medium';
  return 'low';
};

function App() {
  const [backendOnline, setBackendOnline] = useState(null);
  const [error, setError] = useState('');
  const [featuresInput, setFeaturesInput] = useState('');
  const [singleResult, setSingleResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ total: 0, threats: 0, normal: 0 });
  const [batchSize, setBatchSize] = useState(5);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResults, setBatchResults] = useState([]);
  const [systemLogs, setSystemLogs] = useState([]);
  const [expectedFeatureCount, setExpectedFeatureCount] = useState(41);
  const [activeProfile, setActiveProfile] = useState('unknown');
  const [runtimeParams, setRuntimeParams] = useState({
    calibrationMethod: 'unknown',
    sampleSource: 'unknown',
    ensembleMethod: 'unknown',
    algorithms: []
  });
  const [autoLoopRunning, setAutoLoopRunning] = useState(false);
  const [loopIntervalSec, setLoopIntervalSec] = useState(3);
  const [loopTargetSamples, setLoopTargetSamples] = useState('');
  const [loopIteration, setLoopIteration] = useState(0);
  const [loopProcessedSamples, setLoopProcessedSamples] = useState(0);

  const autoLoopRunningRef = useRef(false);
  const batchSizeRef = useRef(batchSize);
  const loopIntervalRef = useRef(loopIntervalSec);
  const loopTargetRef = useRef(null);
  const loopIterationRef = useRef(0);
  const loopProcessedRef = useRef(0);
  const loopBusyRef = useRef(false);
  const loopTimerRef = useRef(null);

  const pushLog = (message) => {
    const level = logLevelFromEvent(message.toLowerCase());
    const item = {
      id: Date.now() + Math.random(),
      message,
      level,
      time: new Date().toLocaleTimeString()
    };
    setSystemLogs((prev) => [item, ...prev].slice(0, 80));
  };

  const fetchModelInfo = async (silent = false) => {
    try {
      const response = await fetch(`${API_URL}/model-info`);
      if (!response.ok) {
        if (!silent) {
          pushLog('Model info endpoint unavailable');
        }
        return;
      }

      const data = await response.json();
      if (typeof data.feature_count === 'number' && data.feature_count > 0) {
        setExpectedFeatureCount(data.feature_count);
      }
      setActiveProfile(data.profile || data.model_type || 'unknown');
      setRuntimeParams({
        calibrationMethod: data.calibration_method || 'none',
        sampleSource: data.sample_source || 'unknown',
        ensembleMethod: data.ensemble_method || 'unknown',
        algorithms: Array.isArray(data.algorithms) ? data.algorithms : []
      });
    } catch {
      if (!silent) {
        pushLog('Could not fetch model information');
      }
    }
  };

  const checkBackendHealth = async (silent = false) => {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (!response.ok) throw new Error('Backend health check failed');
      setBackendOnline(true);
      await fetchModelInfo(true);
      if (!silent) pushLog('Backend online and responding');
      return true;
    } catch {
      setBackendOnline(false);
      if (!silent) pushLog('Backend offline or unreachable');
      return false;
    }
  };

  useEffect(() => {
    checkBackendHealth();
    const timer = setInterval(() => {
      checkBackendHealth(true);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);

  useEffect(() => {
    loopIntervalRef.current = loopIntervalSec;
  }, [loopIntervalSec]);

  useEffect(() => {
    const parsed = Number(loopTargetSamples);
    if (Number.isFinite(parsed) && parsed > 0) {
      loopTargetRef.current = parsed;
    } else {
      loopTargetRef.current = null;
    }
  }, [loopTargetSamples]);

  useEffect(() => {
    return () => {
      autoLoopRunningRef.current = false;
      if (loopTimerRef.current) {
        clearTimeout(loopTimerRef.current);
      }
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (backendOnline === null) return 'Checking backend...';
    return backendOnline ? 'Backend Online' : 'Backend Offline';
  }, [backendOnline]);

  const trendData = useMemo(() => {
    const recent = history.slice(0, 10).reverse();
    return recent.map((item, index) => ({
      index: index + 1,
      threatProb: Number(item.prob),
      normalProb: Number((100 - Number(item.prob)).toFixed(1))
    }));
  }, [history]);

  const pieData = useMemo(
    () => [
      { name: 'Threat', value: stats.threats },
      { name: 'Normal', value: stats.normal }
    ],
    [stats]
  );

  const batchThreatSummary = useMemo(() => {
    const summary = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    batchResults.forEach((result) => {
      summary[result.threat_level] = (summary[result.threat_level] || 0) + 1;
    });
    return [
      { level: 'HIGH', count: summary.HIGH },
      { level: 'MEDIUM', count: summary.MEDIUM },
      { level: 'LOW', count: summary.LOW }
    ];
  }, [batchResults]);

  const analyzeSingle = async () => {
    const features = parseFeatures(featuresInput);

    if (features.length !== expectedFeatureCount) {
      const message = `Expected ${expectedFeatureCount} features, got ${features.length}`;
      setError(message);
      pushLog(`Error: ${message}`);
      return;
    }

    try {
      setError('');
      const response = await fetch(`${API_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Prediction failed');

      setSingleResult(data);

      const historyItem = {
        id: Date.now(),
        prediction: data.prediction === 1 ? 'ATTACK' : 'NORMAL',
        threatLevel: data.threat_level,
        prob: (data.attack_prob * 100).toFixed(1),
        time: new Date().toLocaleTimeString()
      };

      setHistory((prev) => [historyItem, ...prev].slice(0, 40));
      setStats((prev) => ({
        total: prev.total + 1,
        threats: prev.threats + (data.prediction === 1 ? 1 : 0),
        normal: prev.normal + (data.prediction === 1 ? 0 : 1)
      }));

      pushLog(
        `Single analysis complete: ${historyItem.prediction} (${historyItem.prob}% threat probability)`
      );
    } catch (err) {
      const message = err.message || 'Prediction failed';
      setError(message);
      pushLog(`Prediction failed: ${message}`);
    }
  };

  const buildBatchRecords = async (size) => {
    let records = [];

    const sampleResponse = await fetch(`${API_URL}/sample-batch?size=${size}`);
    if (sampleResponse.ok) {
      const sampleData = await sampleResponse.json();
      records = (sampleData.records || []).map((row, index) => ({
        id: row.id || index + 1,
        features: row.features
      }));
    }

    if (records.length === 0) {
      records = Array.from({ length: size }, (_, i) => ({
        id: i + 1,
        features: generateFeatureVector(expectedFeatureCount)
      }));
    }

    return records;
  };

  const applyBatchUpdates = (results, sourceLabel) => {
    setBatchResults(results);

    const threats = results.filter((item) => item.prediction === 1).length;
    const normals = results.length - threats;

    setStats((prev) => ({
      total: prev.total + results.length,
      threats: prev.threats + threats,
      normal: prev.normal + normals
    }));

    const historyItems = results.slice(0, 20).map((item, idx) => ({
      id: Date.now() + idx + Math.random(),
      prediction: item.prediction === 1 ? 'ATTACK' : 'NORMAL',
      threatLevel: item.threat_level,
      prob: (item.attack_prob * 100).toFixed(1),
      time: new Date().toLocaleTimeString()
    }));

    if (historyItems.length > 0) {
      setHistory((prev) => [...historyItems, ...prev].slice(0, 40));
    }

    pushLog(`${sourceLabel} complete: ${threats} threats detected out of ${results.length}`);
  };

  const executeBatch = async (size, sourceLabel = 'Batch') => {
    setError('');
    setBatchLoading(true);

    try {
      const records = await buildBatchRecords(size);
      const response = await fetch(`${API_URL}/predict-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Batch analysis failed');

      const results = data.results || [];
      applyBatchUpdates(results, sourceLabel);
      return results;
    } catch (err) {
      const message = err.message || 'Batch analysis failed';
      setError(message);
      pushLog(`${sourceLabel} failed: ${message}`);
      throw err;
    } finally {
      setBatchLoading(false);
    }
  };

  const runBatch = async () => {
    const size = Number(batchSize);
    if (!Number.isFinite(size) || size < 1 || size > 100) {
      const message = 'Batch size must be between 1 and 100';
      setError(message);
      pushLog(`Error: ${message}`);
      return;
    }

    setBatchResults([]);
    pushLog(`Batch analysis started for ${size} records`);
    try {
      await executeBatch(size, 'Batch run');
    } catch {
      // Error already handled in executeBatch.
    }
  };

  const stopAutoLoop = (reason) => {
    autoLoopRunningRef.current = false;
    setAutoLoopRunning(false);
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }

    if (reason) {
      pushLog(reason);
      return;
    }

    if (loopIterationRef.current > 0) {
      pushLog(
        `Auto loop stopped after ${loopIterationRef.current} cycles and ${loopProcessedRef.current} samples`
      );
    } else {
      pushLog('Auto loop stopped');
    }
  };

  const runAutoLoopCycle = async () => {
    if (!autoLoopRunningRef.current) return;
    if (loopBusyRef.current) return;

    const size = Number(batchSizeRef.current);
    if (!Number.isFinite(size) || size < 1 || size > 100) {
      setError('Batch size must be between 1 and 100');
      stopAutoLoop();
      return;
    }

    loopBusyRef.current = true;
    loopIterationRef.current += 1;
    setLoopIteration(loopIterationRef.current);

    try {
      const results = await executeBatch(size, `Auto loop #${loopIterationRef.current}`);
      loopProcessedRef.current += results.length;
      setLoopProcessedSamples(loopProcessedRef.current);

      if (loopTargetRef.current && loopProcessedRef.current >= loopTargetRef.current) {
        stopAutoLoop(
          `Auto loop completed target: ${loopProcessedRef.current}/${loopTargetRef.current} samples in ${loopIterationRef.current} cycles`
        );
        loopBusyRef.current = false;
        return;
      }
    } catch {
      stopAutoLoop();
      loopBusyRef.current = false;
      return;
    }

    loopBusyRef.current = false;

    if (!autoLoopRunningRef.current) return;
    const delay = Math.max(1, Number(loopIntervalRef.current)) * 1000;
    loopTimerRef.current = setTimeout(runAutoLoopCycle, delay);
  };

  const startAutoLoop = async () => {
    if (autoLoopRunningRef.current) return;

    const ok = await checkBackendHealth(true);
    if (!ok) {
      setError('Backend is offline. Cannot start auto loop.');
      pushLog('Auto loop blocked: backend offline');
      return;
    }

    const size = Number(batchSize);
    if (!Number.isFinite(size) || size < 1 || size > 100) {
      const message = 'Batch size must be between 1 and 100';
      setError(message);
      pushLog(`Error: ${message}`);
      return;
    }

    const interval = Number(loopIntervalSec);
    if (!Number.isFinite(interval) || interval < 1 || interval > 120) {
      const message = 'Loop interval must be between 1 and 120 seconds';
      setError(message);
      pushLog(`Error: ${message}`);
      return;
    }

    const targetInput = String(loopTargetSamples).trim();
    if (targetInput.length > 0) {
      const target = Number(targetInput);
      if (!Number.isFinite(target) || target < 1 || target > 50000) {
        const message = 'Stop-after N must be between 1 and 50000';
        setError(message);
        pushLog(`Error: ${message}`);
        return;
      }
      loopTargetRef.current = target;
    } else {
      loopTargetRef.current = null;
    }

    setError('');
    loopIterationRef.current = 0;
    loopProcessedRef.current = 0;
    setLoopIteration(0);
    setLoopProcessedSamples(0);
    autoLoopRunningRef.current = true;
    setAutoLoopRunning(true);
    const targetText = loopTargetRef.current ? `, stop at ${loopTargetRef.current} samples` : '';
    pushLog(`Auto loop started: ${size} samples every ${interval}s${targetText}`);
    runAutoLoopCycle();
  };

  const generateSample = () => {
    const loadSample = async () => {
      try {
        const response = await fetch(`${API_URL}/sample-features`);
        if (!response.ok) {
          throw new Error('Could not fetch sample from backend dataset');
        }

        const data = await response.json();
        if (!Array.isArray(data.features)) {
          throw new Error('Invalid sample payload');
        }

        setFeaturesInput(data.features.map((value) => Number(value).toFixed(6)).join(', '));
        setError('');
        pushLog(`Dataset sample loaded (${data.profile || activeProfile})`);
      } catch {
        setFeaturesInput(generateFeatureVector(expectedFeatureCount).map((value) => value.toFixed(6)).join(', '));
        setError('');
        pushLog('Fallback random sample generated');
      }
    };

    loadSample();
  };

  const randomizeBatchSize = () => {
    const size = Math.floor(Math.random() * 20) + 5;
    setBatchSize(size);
    pushLog(`Batch size set to ${size}`);
  };

  const clearHistory = () => {
    setHistory([]);
    pushLog('Prediction history cleared');
  };

  const clearLogs = () => {
    setSystemLogs([]);
    setTimeout(() => {
      pushLog('System logs cleared');
    }, 0);
  };

  const predictionText =
    singleResult?.prediction === 1 ? 'ATTACK DETECTED' : singleResult ? 'NORMAL TRAFFIC' : '-';
  const normalPct = singleResult ? (singleResult.normal_prob * 100).toFixed(1) : '0.0';
  const attackPct = singleResult ? (singleResult.attack_prob * 100).toFixed(1) : '0.0';
  const loopTargetDisplay = Number(loopTargetSamples);
  const hasLoopTarget = Number.isFinite(loopTargetDisplay) && loopTargetDisplay > 0;

  return (
    <div className="app-shell">
      <aside className="left-rail">
        <div className="brand-card">
          <h1>Sentinel IDS</h1>
          <p>Security Operations Console</p>
        </div>

        <div className="status-card">
          <div className={`status-pill ${backendOnline ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            {statusLabel}
          </div>
          <p>{expectedFeatureCount}-feature {activeProfile} runtime inference</p>
        </div>

        <div className="status-card model-params">
          <h3>Runtime Parameters</h3>
          <p>Profile: {activeProfile}</p>
          <p>Features: {expectedFeatureCount}</p>
          <p>Calibration: {runtimeParams.calibrationMethod}</p>
          <p>Sample Source: {runtimeParams.sampleSource}</p>
          <p>Ensemble: {runtimeParams.ensembleMethod}</p>
          <p>Algorithms: {runtimeParams.algorithms.join(', ') || 'n/a'}</p>
        </div>

        <div className="stats-stack">
          <div className="kpi total">
            <span>Total Predictions</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="kpi threat">
            <span>Threats Detected</span>
            <strong>{stats.threats}</strong>
          </div>
          <div className="kpi normal">
            <span>Normal Traffic</span>
            <strong>{stats.normal}</strong>
          </div>
        </div>
      </aside>

      <main className="main-layout">
        <section className="panel traffic-panel">
          <header>
            <h2>Traffic Inspection</h2>
            <p>Provide {expectedFeatureCount} feature values or pull a sample from backend test data</p>
          </header>

          <label>Feature Vector</label>
          <textarea
            value={featuresInput}
            onChange={(e) => setFeaturesInput(e.target.value)}
            placeholder="Enter comma/newline separated values"
          />

          <div className="button-row">
            <button className="btn-primary" onClick={analyzeSingle}>Analyze Sample</button>
            <button className="btn-secondary" onClick={generateSample}>Generate Sample</button>
          </div>

          <div className={`single-result ${singleResult?.prediction === 1 ? 'threat' : 'normal'}`}>
            <div className="meta">Prediction Result</div>
            <div className="value">{predictionText}</div>
            <div className="prob-grid">
              <div>
                <span>Normal</span>
                <div className="bar-track">
                  <div className="bar-fill safe" style={{ width: `${normalPct}%` }}>{normalPct}%</div>
                </div>
              </div>
              <div>
                <span>Attack</span>
                <div className="bar-track">
                  <div className="bar-fill threat" style={{ width: `${attackPct}%` }}>{attackPct}%</div>
                </div>
              </div>
            </div>
            <div className={`threat-badge ${(singleResult?.threat_level || 'LOW').toLowerCase()}`}>
              {singleResult?.threat_level || 'LOW'}
            </div>
          </div>

          {error ? <div className="error-box">{error}</div> : null}
        </section>

        <section className="panel charts-panel">
          <header>
            <h2>Threat Analytics</h2>
            <p>Live charts from current session predictions</p>
          </header>

          <div className="charts-grid">
            <div className="chart-card">
              <h3>Threat Probability Trend</h3>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="threatFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff6173" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#ff6173" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#263952" />
                    <XAxis dataKey="index" stroke="#89a5c3" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#89a5c3" tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#101a2a', border: '1px solid #2a3f5b', borderRadius: 8 }}
                      labelStyle={{ color: '#d8e6fa' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="threatProb"
                      stroke="#ff6173"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#threatFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-box">Run single predictions to render trend chart.</div>
              )}
            </div>

            <div className="chart-card split">
              <div>
                <h3>Prediction Distribution</h3>
                {stats.total > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={3}>
                        {pieData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={entry.name === 'Threat' ? PREDICTION_COLORS.threat : PREDICTION_COLORS.normal}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#101a2a', border: '1px solid #2a3f5b', borderRadius: 8 }}
                      />
                      <Legend wrapperStyle={{ color: '#91a8c8', fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-box">Distribution appears after first prediction.</div>
                )}
              </div>

              <div>
                <h3>Batch Threat Levels</h3>
                {batchResults.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={batchThreatSummary} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#263952" />
                      <XAxis dataKey="level" stroke="#89a5c3" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#89a5c3" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#101a2a', border: '1px solid #2a3f5b', borderRadius: 8 }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {batchThreatSummary.map((entry) => (
                          <Cell key={entry.level} fill={THREAT_COLORS[entry.level]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-box">Run batch analysis to view level chart.</div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="panel batch-panel">
          <header>
            <h2>Batch Analysis</h2>
            <p>Evaluate dataset-backed sample groups against the active model profile</p>
          </header>

          <div className="batch-input-grid">
            <div>
              <label>Batch Size</label>
              <input
                type="number"
                min="1"
                max="100"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
              />
            </div>
            <div>
              <label>Loop Interval (sec)</label>
              <input
                type="number"
                min="1"
                max="120"
                value={loopIntervalSec}
                onChange={(e) => setLoopIntervalSec(e.target.value)}
              />
            </div>
            <div>
              <label>Stop After N Samples</label>
              <input
                type="number"
                min="1"
                max="50000"
                value={loopTargetSamples}
                onChange={(e) => setLoopTargetSamples(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="button-row batch-actions">
            <button className="btn-primary" onClick={runBatch} disabled={batchLoading}>Run Batch Once</button>
            {autoLoopRunning ? (
              <button className="btn-danger" onClick={stopAutoLoop}>Stop Auto Loop</button>
            ) : (
              <button className="btn-primary" onClick={startAutoLoop}>Start Auto Loop</button>
            )}
            <button className="btn-secondary" onClick={randomizeBatchSize}>Generate Size</button>
          </div>

          <div className={`loop-status ${autoLoopRunning ? 'running' : 'stopped'}`}>
            {autoLoopRunning
              ? `Auto loop running: cycle ${loopIteration}, processed ${loopProcessedSamples}${hasLoopTarget ? `/${loopTargetDisplay}` : ''} samples`
              : 'Auto loop stopped'}
          </div>

          {batchLoading ? <div className="loading-row">Analyzing batch...</div> : null}
          {batchResults.length > 0 ? (
            <div className="result-list compact">
              {batchResults.map((item) => (
                <div className={`result-item ${item.prediction === 1 ? 'threat' : 'normal'}`} key={`${item.id}-${item.attack_prob}`}>
                  <div>
                    <strong>Sample #{item.id}</strong>
                    <p>
                      {item.prediction === 1 ? 'ATTACK' : 'NORMAL'} - {item.threat_level} ({(item.attack_prob * 100).toFixed(1)}%)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="panel logs-panel">
          <header>
            <h2>Operational Logs</h2>
            <div className="header-actions">
              <button className="btn-secondary small" onClick={clearHistory}>Clear History</button>
              <button className="btn-secondary small" onClick={clearLogs}>Clear Logs</button>
            </div>
          </header>

          <div className="logs-grid">
            <div>
              <h3>Prediction History</h3>
              {history.length > 0 ? (
                <div className="result-list">
                  {history.map((item) => (
                    <div className={`result-item ${item.prediction === 'ATTACK' ? 'threat' : 'normal'}`} key={item.id}>
                      <div>
                        <strong>{item.prediction}</strong>
                        <p>{item.threatLevel} - {item.prob}% threat probability</p>
                      </div>
                      <span>{item.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-box">No predictions yet.</div>
              )}
            </div>

            <div>
              <h3>System Log Stream</h3>
              {systemLogs.length > 0 ? (
                <div className="log-stream">
                  {systemLogs.map((item) => (
                    <div className={`log-entry ${item.level}`} key={item.id}>
                      <div>
                        <strong>{item.time}</strong>
                        <p>{item.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-box">System logs will appear as actions run.</div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
