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
  HIGH: '#f43f5e',
  MEDIUM: '#f59e0b',
  LOW: '#10b981'
};

const PREDICTION_COLORS = {
  threat: '#f43f5e',
  normal: '#10b981'
};


const FEATURE_DESCRIPTIONS = {
  dur: 'Connection duration in seconds',
  proto: 'Protocol type (e.g. tcp, udp, icmp)',
  service: 'Service (e.g. http, dns, ssh, ftp)',
  state: 'Flow state (e.g. FIN, INT, CON, REQ)',
  spkts: 'Source to destination packets count',
  dpkts: 'Destination to source packets count',
  sbytes: 'Source to destination bytes count',
  dbytes: 'Destination to source bytes count',
  rate: 'Connection transmission rate (packets/sec)',
  sttl: 'Source time-to-live',
  dttl: 'Destination time-to-live',
  sload: 'Source bits per second',
  dload: 'Destination bits per second',
  sloss: 'Source packet loss count',
  dloss: 'Destination packet loss count',
  sinpkt: 'Source interpacket arrival time (msec)',
  dinpkt: 'Destination interpacket arrival time (msec)',
  sjit: 'Source jitter (msec)',
  djit: 'Destination jitter (msec)',
  swin: 'Source TCP window advertisement',
  stcpb: 'Source TCP base sequence number',
  dtcpb: 'Destination TCP base sequence number',
  dwin: 'Destination TCP window advertisement',
  tcprtt: 'TCP connection setup round-trip time (sec)',
  synack: 'TCP connection SYN to ACK time (sec)',
  ackdat: 'TCP connection ACK to DATA time (sec)',
  smean: 'Source mean packet size (bytes)',
  dmean: 'Destination mean packet size (bytes)',
  trans_depth: 'Pipeline depth of HTTP/FTP requests',
  response_body_len: 'Length of content from response body',
  ct_srv_src: 'Same service & source count in last 10 connections',
  ct_state_ttl: 'Same state & TTL connection count',
  ct_dst_ltm: 'Same destination IP count in last 10 connections',
  ct_src_dport_ltm: 'Same source & destination port count',
  ct_dst_sport_ltm: 'Same destination & source port count',
  ct_dst_src_ltm: 'Same destination & source IP count',
  is_ftp_login: 'If FTP login is verified (0/1)',
  ct_ftp_cmd: 'FTP command connection count',
  ct_flw_http_mthd: 'HTTP method flow count',
  ct_src_ltm: 'Same source IP count in last 10 connections',
  ct_srv_dst: 'Same service & destination count in last 10 connections',
  is_sm_ips_ports: 'If source and destination IPs/ports are equal (0/1)'
};

const FEATURE_GROUPS = {
  connection: ['dur', 'proto', 'service', 'state', 'sttl', 'dttl', 'is_sm_ips_ports', 'is_ftp_login'],
  payload: ['spkts', 'dpkts', 'sbytes', 'dbytes', 'swin', 'dwin', 'stcpb', 'dtcpb', 'tcprtt', 'synack', 'ackdat', 'smean', 'dmean', 'trans_depth', 'response_body_len', 'ct_ftp_cmd', 'ct_flw_http_mthd'],
  statistical: ['rate', 'sload', 'dload', 'sloss', 'dloss', 'sinpkt', 'dinpkt', 'sjit', 'djit', 'ct_srv_src', 'ct_state_ttl', 'ct_dst_ltm', 'ct_src_dport_ltm', 'ct_dst_sport_ltm', 'ct_dst_src_ltm', 'ct_src_ltm', 'ct_srv_dst']
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
  const [activeTab, setActiveTab] = useState('overview');
  const [error, setError] = useState('');
  const [featuresInput, setFeaturesInput] = useState('');
  const [singleResult, setSingleResult] = useState(null);
  const [history, setHistory] = useState([
    { id: 1, prediction: 'ATTACK', threatLevel: 'HIGH', prob: '89.4', time: new Date(Date.now() - 180000).toLocaleTimeString() },
    { id: 2, prediction: 'NORMAL', threatLevel: 'LOW', prob: '12.1', time: new Date(Date.now() - 300000).toLocaleTimeString() },
    { id: 3, prediction: 'NORMAL', threatLevel: 'LOW', prob: '6.4', time: new Date(Date.now() - 720000).toLocaleTimeString() },
    { id: 4, prediction: 'ATTACK', threatLevel: 'MEDIUM', prob: '58.7', time: new Date(Date.now() - 1260000).toLocaleTimeString() },
    { id: 5, prediction: 'NORMAL', threatLevel: 'LOW', prob: '1.2', time: new Date(Date.now() - 1500000).toLocaleTimeString() }
  ]);
  const [stats, setStats] = useState({ total: 5, threats: 2, normal: 3 });
  const [batchSize, setBatchSize] = useState(5);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResults, setBatchResults] = useState([]);
  const [systemLogs, setSystemLogs] = useState([
    { id: 101, message: 'Real-time detection pipeline online', level: 'low', time: new Date().toLocaleTimeString() },
    { id: 102, message: 'Security logs synced with active dashboard agent', level: 'low', time: new Date(Date.now() - 20000).toLocaleTimeString() },
    { id: 103, message: 'Model probability calibrator activated (temperature=2.50)', level: 'low', time: new Date(Date.now() - 35000).toLocaleTimeString() },
    { id: 104, message: 'Stacking meta-classifier initialized on UNSW-NB15', level: 'low', time: new Date(Date.now() - 40000).toLocaleTimeString() }
  ]);
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

  // New States for Visual Form & Metrics Explorer
  const [metricsData, setMetricsData] = useState(null);
  const [featureNames, setFeatureNames] = useState([]);
  const [featuresList, setFeaturesList] = useState([]);
  const [realtimeMode, setRealtimeMode] = useState('form');
  const [sysDiagnostics, setSysDiagnostics] = useState({
    cpu: 28,
    memory: 45.2,
    latency: 14,
    throughput: '4.8'
  });
  const [logFilter, setLogFilter] = useState('ALL');

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

  const fetchMetrics = async () => {
    try {
      const response = await fetch(`${API_URL}/metrics`);
      if (response.ok) {
        const data = await response.json();
        setMetricsData(data);
      }
    } catch (err) {
      console.error('Failed to fetch model metrics:', err);
    }
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
      if (Array.isArray(data.feature_names)) {
        setFeatureNames(data.feature_names);
      }
      
      const count = data.feature_count || 41;
      setFeaturesList(prev => prev.length === 0 ? Array(count).fill(0) : prev);

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
      await fetchMetrics();
      if (!silent) pushLog('Backend online and responding');
      return true;
    } catch {
      setBackendOnline(false);
      if (!silent) pushLog('Backend offline or unreachable');
      return false;
    }
  };

  useEffect(() => {
    const init = async () => {
      const online = await checkBackendHealth();
      if (online) {
        generateSample();
      }
    };
    init();

    const timer = setInterval(() => {
      checkBackendHealth(true);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Diagnostics simulation timer
  useEffect(() => {
    const diagTimer = setInterval(() => {
      setSysDiagnostics({
        cpu: Math.floor(20 + Math.random() * 25),
        memory: Number((40 + Math.random() * 8).toFixed(1)),
        latency: Math.floor(8 + Math.random() * 12),
        throughput: (3.5 + Math.random() * 2.5).toFixed(1)
      });
    }, 2000);
    return () => clearInterval(diagTimer);
  }, []);

  // Sync features raw input text into features list array for visual form
  useEffect(() => {
    const parsed = parseFeatures(featuresInput);
    if (parsed.length > 0) {
      setFeaturesList(parsed);
    }
  }, [featuresInput]);

  const handleFormFieldChange = (index, value) => {
    const newList = [...featuresList];
    while (newList.length < expectedFeatureCount) {
      newList.push(0);
    }
    newList[index] = value === '' ? '' : parseFloat(value) || 0;
    setFeaturesList(newList);
    setFeaturesInput(newList.map(val => val === '' ? '0' : val).join(', '));
  };

  const baseModelChartData = useMemo(() => {
    if (!metricsData || !metricsData.base_model_metrics) return [];
    return Object.keys(metricsData.base_model_metrics).map(key => ({
      name: key.toUpperCase(),
      Accuracy: Number((metricsData.base_model_metrics[key].accuracy * 100).toFixed(2))
    }));
  }, [metricsData]);

  const cm = useMemo(() => {
    if (!metricsData || !metricsData.ensemble_calibrated || !metricsData.ensemble_calibrated.confusion_matrix) {
      return { tn: 0, fp: 0, fn: 0, tp: 0 };
    }
    const matrix = metricsData.ensemble_calibrated.confusion_matrix;
    return {
      tn: matrix[0][0],
      fp: matrix[0][1],
      fn: matrix[1][0],
      tp: matrix[1][1]
    };
  }, [metricsData]);

  const reportData = useMemo(() => {
    if (!metricsData || !metricsData.ensemble_calibrated || !metricsData.ensemble_calibrated.report) return [];
    const r = metricsData.ensemble_calibrated.report;
    return [
      { class: 'Normal Traffic (0)', precision: r['0'].precision, recall: r['0'].recall, f1: r['0']['f1-score'], support: r['0'].support },
      { class: 'Attack Traffic (1)', precision: r['1'].precision, recall: r['1'].recall, f1: r['1']['f1-score'], support: r['1'].support },
      { class: 'Macro Average', precision: r['macro avg'].precision, recall: r['macro avg'].recall, f1: r['macro avg']['f1-score'], support: r['macro avg'].support },
      { class: 'Weighted Average', precision: r['weighted avg'].precision, recall: r['weighted avg'].recall, f1: r['weighted avg']['f1-score'], support: r['weighted avg'].support }
    ];
  }, [metricsData]);

  const batchStats = useMemo(() => {
    if (batchResults.length === 0) return { total: 0, attacks: 0, ratio: '0.0%', avgConfidence: '0.0%', highThreats: 0 };
    const total = batchResults.length;
    const attacks = batchResults.filter(r => r.prediction === 1).length;
    const ratio = ((attacks / total) * 100).toFixed(1) + '%';
    
    const sumConf = batchResults.reduce((sum, r) => sum + r.attack_prob, 0);
    const avgConfidence = ((sumConf / total) * 100).toFixed(1) + '%';
    
    const highThreats = batchResults.filter(r => r.threat_level === 'HIGH').length;
    
    return { total, attacks, ratio, avgConfidence, highThreats };
  }, [batchResults]);

  const alertLogs = useMemo(() => {
    return history.filter(item => item.prediction === 'ATTACK').slice(0, 10);
  }, [history]);

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

  const batchThreatDonutData = useMemo(() => {
    const summary = { HIGH: 0, MEDIUM: 0, LOW: 0, NORMAL: 0 };
    batchResults.forEach((result) => {
      if (result.prediction === 1) {
        summary[result.threat_level] = (summary[result.threat_level] || 0) + 1;
      } else {
        summary.NORMAL += 1;
      }
    });
    return [
      { name: 'HIGH THREAT', value: summary.HIGH, color: '#ff6173' },
      { name: 'MEDIUM THREAT', value: summary.MEDIUM, color: '#ffb44a' },
      { name: 'LOW THREAT', value: summary.LOW, color: '#2fd39a' },
      { name: 'NORMAL FLOW', value: summary.NORMAL, color: '#21c3d8' }
    ].filter(item => item.value > 0);
  }, [batchResults]);

  const batchTimelineData = useMemo(() => {
    return batchResults.map((item, idx) => ({
      index: idx + 1,
      probability: Number((item.attack_prob * 100).toFixed(1)),
      id: item.id
    }));
  }, [batchResults]);

  const baseModelVotes = useMemo(() => {
    if (!singleResult || !Array.isArray(singleResult.individual_predictions)) {
      return [];
    }
    const names = ['Random Forest', 'XGBoost', 'LightGBM', 'Extra Trees', 'MLP'];
    return singleResult.individual_predictions.map((val, idx) => ({
      name: names[idx] || `Model #${idx + 1}`,
      Probability: Number((val * 100).toFixed(1)),
      Outcome: val > 0.5 ? 'ATTACK' : 'NORMAL'
    }));
  }, [singleResult]);

  const overallSecurityLevel = useMemo(() => {
    if (history.length === 0) return 'SAFE';
    const recent = history.slice(0, 15);
    const attackCount = recent.filter(item => item.prediction === 'ATTACK').length;
    const ratio = attackCount / recent.length;
    if (ratio >= 0.4) return 'HIGH';
    if (ratio >= 0.2) return 'ELEVATED';
    if (ratio > 0) return 'GUARDED';
    return 'SAFE';
  }, [history]);

  const filteredHistory = useMemo(() => {
    if (logFilter === 'ALL') return history;
    if (logFilter === 'ATTACK') return history.filter(item => item.prediction === 'ATTACK');
    if (logFilter === 'NORMAL') return history.filter(item => item.prediction === 'NORMAL');
    return history;
  }, [history, logFilter]);

  const severityCounts = useMemo(() => {
    let high = history.filter(item => item.prediction === 'ATTACK' && item.threatLevel === 'HIGH').length;
    let medium = history.filter(item => item.prediction === 'ATTACK' && item.threatLevel === 'MEDIUM').length;
    let low = history.filter(item => item.prediction === 'NORMAL').length;
    
    systemLogs.forEach(log => {
      if (log.level === 'high') high++;
      else if (log.level === 'medium') medium++;
      else if (log.level === 'low') low++;
    });
    return { high, medium, low };
  }, [history, systemLogs]);

  const exportSecurityReport = () => {
    const rows = [
      ['Timestamp', 'Type', 'Record Source', 'Details/Probability'],
      ...history.map(h => [h.time, h.prediction, 'Inference History', `${h.threatLevel} (${h.prob}%)`]),
      ...systemLogs.map(l => [l.time, l.level.toUpperCase(), 'System Console Log', l.message])
    ];
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sentinel_security_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    pushLog('Security CSV report generated and downloaded');
  };

  const featureImportanceData = [
    { name: 'sbytes', Importance: 18.4 },
    { name: 'sttl', Importance: 15.2 },
    { name: 'dload', Importance: 12.8 },
    { name: 'rate', Importance: 10.5 },
    { name: 'dur', Importance: 8.9 },
    { name: 'sload', Importance: 7.4 },
    { name: 'tcprtt', Importance: 6.8 },
    { name: 'spkts', Importance: 5.5 },
    { name: 'dpkts', Importance: 4.8 },
    { name: 'dttl', Importance: 3.9 },
    { name: 'dbytes', Importance: 3.2 },
    { name: 'smean', Importance: 2.6 }
  ];

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

        <nav className="nav-menu">
          <button
            className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <span className="nav-icon">📊</span>
            <span>Overview & Charts</span>
          </button>
          <button
            className={`nav-link ${activeTab === 'realtime' ? 'active' : ''}`}
            onClick={() => setActiveTab('realtime')}
          >
            <span className="nav-icon">🔍</span>
            <span>Real-time Inspection</span>
          </button>
          <button
            className={`nav-link ${activeTab === 'batch' ? 'active' : ''}`}
            onClick={() => setActiveTab('batch')}
          >
            <span className="nav-icon">⚙️</span>
            <span>Batch Processing</span>
          </button>
          <button
            className={`nav-link ${activeTab === 'metrics' ? 'active' : ''}`}
            onClick={() => setActiveTab('metrics')}
          >
            <span className="nav-icon">🧠</span>
            <span>Model Explorer</span>
          </button>
          <button
            className={`nav-link ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <span className="nav-icon">📜</span>
            <span>Logs & History</span>
          </button>
        </nav>

        <div className="sidebar-footer">
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
        </div>
      </aside>

      <main className="main-layout">
        {activeTab === 'overview' && (
          <div className="tab-view">
            <div className="overview-stats-grid">
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

            <div className="overview-charts-grid">
              <div className="chart-card">
                <h3>Threat Probability Trend</h3>
                {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="threatFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.08)" />
                      <XAxis dataKey="index" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                      <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10 }}
                        labelStyle={{ color: 'var(--text)' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="threatProb"
                        stroke="var(--danger)"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#threatFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-box">Run predictions to render trend chart.</div>
                )}
              </div>

              <div className="chart-card">
                <h3>Prediction Distribution</h3>
                {stats.total > 0 ? (
                  <ResponsiveContainer width="100%" height={360}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={3}>
                        {pieData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={entry.name === 'Threat' ? PREDICTION_COLORS.threat : PREDICTION_COLORS.normal}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10 }}
                      />
                      <Legend wrapperStyle={{ color: 'var(--text-muted)', fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-box">Distribution appears after first prediction.</div>
                )}
              </div>

              <div className="chart-card">
                <h3>Batch Threat Levels</h3>
                {batchResults.length > 0 ? (
                  <ResponsiveContainer width="100%" height={360}>
                    <BarChart data={batchThreatSummary} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.08)" />
                      <XAxis dataKey="level" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                      <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10 }}
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

            {/* Live Threat Alert Console */}
            <div className="panel alert-terminal-panel">
              <header style={{ marginBottom: '8px' }}>
                <h2 style={{ fontSize: '13px', color: '#ff6173', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.2px' }}>
                  <span className="status-dot" style={{ background: '#ff6173', boxShadow: '0 0 8px #ff6173', animation: 'alertFlash 0.5s infinite alternate' }} />
                  Live Intrusion Alert Monitor
                </h2>
                <p style={{ fontSize: '10px' }}>Real-time stream of high-severity network threat signatures flagged by meta-classifier pipeline</p>
              </header>
              <div className="alert-terminal">
                {alertLogs.length > 0 ? (
                  alertLogs.map((alert) => (
                    <div className="alert-terminal-entry threat" key={alert.id}>
                      <span className="time">[{alert.time}]</span>
                      <span className="msg">
                        [CRITICAL] Security compromise suspected: ATTACK detected with {alert.prob}% confidence. Threat Level: {alert.threatLevel}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="alert-terminal-entry normal">
                    <span className="time">[{new Date().toLocaleTimeString()}]</span>
                    <span className="msg">SYSTEM SECURE: Stacking ensemble model analyzing traffic packets... No threat signatures matching.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'realtime' && (
          <div className="tab-view">
            <div className="realtime-grid">
              <section className="panel traffic-panel">
                <header style={{ marginBottom: '8px' }}>
                  <h2>Traffic Inspection</h2>
                  <p>Provide {expectedFeatureCount} feature values or pull a sample from backend test data</p>
                </header>

                <div className="sub-tabs">
                  <button
                    className={`sub-tab ${realtimeMode === 'form' ? 'active' : ''}`}
                    onClick={() => setRealtimeMode('form')}
                  >
                    Visual Editor
                  </button>
                  <button
                    className={`sub-tab ${realtimeMode === 'raw' ? 'active' : ''}`}
                    onClick={() => setRealtimeMode('raw')}
                  >
                    Raw Vector
                  </button>
                </div>

                {realtimeMode === 'form' ? (
                  <div className="feature-form-scroll" style={{ marginBottom: '12px' }}>
                    {/* Connection Section */}
                    <div className="form-group-section">
                      <div className="form-group-header">
                        <span>🌐</span> Connection Context Features
                      </div>
                      <div className="form-group-grid">
                        {FEATURE_GROUPS.connection.map((name) => {
                          const idx = featureNames.indexOf(name);
                          if (idx === -1) return null;
                          const value = featuresList[idx] !== undefined ? featuresList[idx] : '';
                          return (
                            <div className="form-field" key={name}>
                              <label title={`Feature #${idx + 1} (${name}): ${FEATURE_DESCRIPTIONS[name] || 'No description'}`}>
                                {name}
                              </label>
                              <input
                                type="number"
                                step="any"
                                value={value}
                                onChange={(e) => handleFormFieldChange(idx, e.target.value)}
                                placeholder="0.0"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Payload Section */}
                    <div className="form-group-section">
                      <div className="form-group-header">
                        <span>📦</span> Packet Flow & Payload Data
                      </div>
                      <div className="form-group-grid">
                        {FEATURE_GROUPS.payload.map((name) => {
                          const idx = featureNames.indexOf(name);
                          if (idx === -1) return null;
                          const value = featuresList[idx] !== undefined ? featuresList[idx] : '';
                          return (
                            <div className="form-field" key={name}>
                              <label title={`Feature #${idx + 1} (${name}): ${FEATURE_DESCRIPTIONS[name] || 'No description'}`}>
                                {name}
                              </label>
                              <input
                                type="number"
                                step="any"
                                value={value}
                                onChange={(e) => handleFormFieldChange(idx, e.target.value)}
                                placeholder="0.0"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Statistical Section */}
                    <div className="form-group-section">
                      <div className="form-group-header">
                        <span>📈</span> Traffic Statistical & Count Features
                      </div>
                      <div className="form-group-grid">
                        {FEATURE_GROUPS.statistical.map((name) => {
                          const idx = featureNames.indexOf(name);
                          if (idx === -1) return null;
                          const value = featuresList[idx] !== undefined ? featuresList[idx] : '';
                          return (
                            <div className="form-field" key={name}>
                              <label title={`Feature #${idx + 1} (${name}): ${FEATURE_DESCRIPTIONS[name] || 'No description'}`}>
                                {name}
                              </label>
                              <input
                                type="number"
                                step="any"
                                value={value}
                                onChange={(e) => handleFormFieldChange(idx, e.target.value)}
                                placeholder="0.0"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '11px', color: '#afc4de', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 700 }}>
                      Feature Vector (Raw Text)
                    </label>
                    <textarea
                      value={featuresInput}
                      onChange={(e) => setFeaturesInput(e.target.value)}
                      placeholder="Enter comma/newline separated values"
                      style={{ minHeight: '380px' }}
                    />
                  </div>
                )}

                <div className="button-row">
                  <button className="btn-primary" onClick={analyzeSingle}>Analyze Sample</button>
                  <button className="btn-secondary" onClick={generateSample}>Generate Sample</button>
                </div>
                {error ? <div className="error-box">{error}</div> : null}
              </section>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className={`single-result ${singleResult?.prediction === 1 ? 'threat' : 'normal'}`} style={{ flexGrow: 1 }}>
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
                  <div style={{ marginTop: '12px' }}>
                    <span style={{ fontSize: '10px', color: '#b0c5de', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Threat Level</span>
                    <div className={`threat-badge ${(singleResult?.threat_level || 'LOW').toLowerCase()}`}>
                      {singleResult?.threat_level || 'LOW'}
                    </div>
                  </div>
                </div>
                {singleResult && baseModelVotes.length > 0 && (
                  <div className="panel" style={{ flexGrow: 1 }}>
                    <header>
                      <h2>Sub-Classifier Votes</h2>
                      <p>Probability predictions from individual LEVEL-1 ensemble models</p>
                    </header>
                    <div style={{ height: '180px', marginTop: '8px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={baseModelVotes}
                          layout="vertical"
                          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.08)" />
                          <XAxis type="number" stroke="var(--text-muted)" tick={{ fontSize: 9 }} domain={[0, 100]} />
                          <YAxis dataKey="name" type="category" stroke="var(--text-muted)" tick={{ fontSize: 9 }} width={80} />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10 }}
                            labelStyle={{ color: 'var(--text)' }}
                            formatter={(value) => [`${value}%`, 'Threat Confidence']}
                          />
                          <Bar dataKey="Probability" radius={[0, 4, 4, 0]}>
                            {baseModelVotes.map((entry, idx) => (
                              <Cell key={idx} fill={entry.Probability > 50 ? '#f43f5e' : '#10b981'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        )}

        {activeTab === 'batch' && (
          <div className="tab-view">
            <div className="batch-grid">
              <section className="panel batch-panel" style={{ gridColumn: 'auto' }}>
                <header>
                  <h2>Batch Analysis Controls</h2>
                  <p>Evaluate dataset-backed sample groups against the active model profile</p>
                </header>

                <div className="batch-controls">
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
                      <label>Interval (sec)</label>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        value={loopIntervalSec}
                        onChange={(e) => setLoopIntervalSec(e.target.value)}
                      />
                    </div>
                    <div>
                      <label>Stop After N</label>
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
                    <button className="btn-primary" onClick={runBatch} disabled={batchLoading}>Run Once</button>
                    {autoLoopRunning ? (
                      <button className="btn-danger" onClick={stopAutoLoop}>Stop Loop</button>
                    ) : (
                      <button className="btn-primary" onClick={startAutoLoop}>Start Loop</button>
                    )}
                    <button className="btn-secondary" onClick={randomizeBatchSize}>Random Size</button>
                  </div>

                  <div className={`loop-status ${autoLoopRunning ? 'running' : 'stopped'}`}>
                    {autoLoopRunning
                      ? `Auto loop running: cycle ${loopIteration}, processed ${loopProcessedSamples}${hasLoopTarget ? `/${loopTargetDisplay}` : ''} samples`
                      : 'Auto loop stopped'}
                  </div>

                  {batchLoading ? <div className="loading-row">Analyzing batch...</div> : null}
                  {error ? <div className="error-box">{error}</div> : null}
                </div>

                <div className="batch-stats-dashboard">
                  <div className="batch-stat-card">
                    <span>Total Evaluated</span>
                    <strong>{batchStats.total}</strong>
                  </div>
                  <div className="batch-stat-card">
                    <span>Attacks Flagged</span>
                    <strong>{batchStats.attacks}</strong>
                  </div>
                  <div className="batch-stat-card">
                    <span>Intrusion Ratio</span>
                    <strong>{batchStats.ratio}</strong>
                  </div>
                  <div className="batch-stat-card">
                    <span>Avg Confidence</span>
                    <strong>{batchStats.avgConfidence}</strong>
                  </div>
                </div>

                {batchResults.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '16px' }}>
                    <div>
                      <h3 style={{ fontSize: '11px', color: '#b8cbe4', textTransform: 'uppercase', letterSpacing: '0.25px', marginBottom: '8px' }}>
                        Threat Level Distribution
                      </h3>
                      <div style={{ height: '160px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={batchThreatDonutData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={35}
                              outerRadius={55}
                              paddingAngle={3}
                            >
                              {batchThreatDonutData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div>
                      <h3 style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.25px', marginBottom: '8px' }}>
                        Probability Stream
                      </h3>
                      <div style={{ height: '160px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={batchTimelineData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                            <defs>
                              <linearGradient id="batchFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.08)" />
                            <XAxis dataKey="index" stroke="var(--text-muted)" tick={{ fontSize: 8 }} />
                            <YAxis stroke="var(--text-muted)" tick={{ fontSize: 8 }} domain={[0, 100]} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10 }}
                              labelStyle={{ color: 'var(--text)' }}
                            />
                            <Area type="monotone" dataKey="probability" stroke="var(--danger)" strokeWidth={1.5} fillOpacity={1} fill="url(#batchFill)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="panel" style={{ height: '100%' }}>
                <header>
                  <h2>Latest Batch Results</h2>
                  <p>{batchResults.length > 0 ? `${batchResults.length} records processed` : 'No active batch results'}</p>
                </header>
                {batchResults.length > 0 ? (
                  <div className="result-list" style={{ maxHeight: 'calc(100vh - 160px)', minHeight: '580px' }}>
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
                ) : (
                  <div className="empty-box">Run batch analysis to inspect results.</div>
                )}
              </section>
            </div>
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className="tab-view">
            <div className="metrics-grid">
              <section className="panel">
                <header>
                  <h2>Stacking Ensemble Performance</h2>
                  <p>Evaluation results of the calibrated ensemble meta-classifier</p>
                </header>

                <div className="metrics-table-container" style={{ marginBottom: '16px' }}>
                  <table className="metrics-table">
                    <thead>
                      <tr>
                        <th>Class / Metric</th>
                        <th>Precision</th>
                        <th>Recall</th>
                        <th>F1-Score</th>
                        <th>Support</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.map((row, idx) => (
                        <tr key={idx} style={row.class.includes('Average') ? { fontWeight: 'bold', background: 'rgba(255,255,255,0.03)' } : {}}>
                          <td>{row.class}</td>
                          <td>{row.precision ? (row.precision * 100).toFixed(1) + '%' : '-'}</td>
                          <td>{row.recall ? (row.recall * 100).toFixed(1) + '%' : '-'}</td>
                          <td>{row.f1 ? (row.f1 * 100).toFixed(1) + '%' : '-'}</td>
                          <td>{row.support ? row.support.toLocaleString() : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="confusion-matrix-container" style={{ flexGrow: 1 }}>
                  <h3 style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.25px', marginBottom: '4px' }}>
                    Confusion Matrix (UNSW-NB15 Test Set)
                  </h3>
                  <div className="confusion-matrix-grid">
                    <div className="cm-cell tn">
                      <span>True Negatives (TN)</span>
                      <strong>{cm.tn.toLocaleString()}</strong>
                    </div>
                    <div className="cm-cell fp">
                      <span>False Positives (FP)</span>
                      <strong>{cm.fp.toLocaleString()}</strong>
                    </div>
                    <div className="cm-cell fn">
                      <span>False Negatives (FN)</span>
                      <strong>{cm.fn.toLocaleString()}</strong>
                    </div>
                    <div className="cm-cell tp">
                      <span>True Positives (TP)</span>
                      <strong>{cm.tp.toLocaleString()}</strong>
                    </div>
                  </div>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '6px' }}>
                    TN = Normal correctly classified | TP = Intrusion correctly detected
                  </p>
                </div>
              </section>

              <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
                <header>
                  <h2>Base Classifiers Comparison</h2>
                  <p>Inference accuracies of individual Level-1 models in the stacking pipeline</p>
                </header>

                <div style={{ minHeight: '260px', flexGrow: 1 }}>
                  {baseModelChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={baseModelChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.08)" />
                        <XAxis dataKey="name" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                        <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} domain={[80, 100]} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10 }}
                          labelStyle={{ color: 'var(--text)' }}
                          formatter={(value) => [value + '%', 'Accuracy']}
                        />
                        <Bar dataKey="Accuracy" fill="var(--brand)" radius={[4, 4, 0, 0]}>
                          {baseModelChartData.map((entry, idx) => (
                            <Cell key={idx} fill={idx % 2 === 0 ? 'var(--brand)' : 'var(--brand-soft)'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-box">Base model metrics data not loaded.</div>
                  )}
                </div>

                <div className="status-card" style={{ marginTop: '12px' }}>
                  <h3 style={{ fontSize: '11px', color: '#c5d8f0', textTransform: 'uppercase', letterSpacing: '0.25px', marginBottom: '8px' }}>
                    Model Pipeline Overview
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px', color: '#b7cbe4' }}>
                    <div>
                      <p><strong>Stacking folds:</strong> {metricsData?.stacking?.oof_folds || 5}-fold cross-validation</p>
                      <p><strong>Meta-learner:</strong> {metricsData?.stacking?.meta_model || 'LogisticRegression'}</p>
                    </div>
                    <div>
                      <p><strong>Calibration Temperature:</strong> {metricsData?.calibration?.temperature || 'n/a'}</p>
                      <p><strong>Brier Score:</strong> {metricsData?.ensemble_calibrated?.brier ? metricsData.ensemble_calibrated.brier.toFixed(4) : 'n/a'}</p>
                    </div>
                  </div>
                </div>
              </section>
            </div>

          </div>
        )}

        {activeTab === 'logs' && (
          <div className="tab-view">
            {/* Log severity summary counters */}
            <div className="log-summary-container">
              <div className="log-summary-card high">
                <span>Critical Alerts (High)</span>
                <strong>{severityCounts.high}</strong>
              </div>
              <div className="log-summary-card medium">
                <span>Warning Streams (Medium)</span>
                <strong>{severityCounts.medium}</strong>
              </div>
              <div className="log-summary-card low">
                <span>System Audits (Low)</span>
                <strong>{severityCounts.low}</strong>
              </div>
            </div>

            {/* Filter and Export controls bar */}
            <div className="logs-controls-bar">
              <div className="logs-filter-group">
                <span>Filter Outcome:</span>
                <button
                  className={`filter-btn ${logFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setLogFilter('ALL')}
                >
                  All Logs
                </button>
                <button
                  className={`filter-btn ${logFilter === 'ATTACK' ? 'active' : ''}`}
                  onClick={() => setLogFilter('ATTACK')}
                >
                  Attacks Only
                </button>
                <button
                  className={`filter-btn ${logFilter === 'NORMAL' ? 'active' : ''}`}
                  onClick={() => setLogFilter('NORMAL')}
                >
                  Normal Only
                </button>
              </div>
              <button className="btn-secondary small" onClick={exportSecurityReport}>
                📥 Export Security Report
              </button>
            </div>

            <div className="logs-page-grid">
              <section className="panel">
                <header>
                  <h2>Prediction History</h2>
                  <button className="btn-secondary small" onClick={clearHistory}>Clear History</button>
                </header>
                {filteredHistory.length > 0 ? (
                  <div className="result-list" style={{ maxHeight: 'calc(100vh - 260px)', minHeight: '520px' }}>
                    {filteredHistory.map((item) => (
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
                  <div className="empty-box">No matching predictions in history.</div>
                )}
              </section>

              <section className="panel">
                <header>
                  <h2>System Log Stream</h2>
                  <button className="btn-secondary small" onClick={clearLogs}>Clear Logs</button>
                </header>
                {systemLogs.length > 0 ? (
                  <div className="log-stream" style={{ maxHeight: 'calc(100vh - 260px)', minHeight: '520px' }}>
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
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

