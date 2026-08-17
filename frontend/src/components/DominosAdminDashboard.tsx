import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface DeviceOption {
  id: string;
  name: string;
}

interface LogEntry {
  message: string;
  type: 'info' | 'error' | 'success';
  timestamp: string;
}

export const DominosAdminDashboard: React.FC = () => {
  // Config state
  const [devices, setDevices] = useState<string[]>([]);
  const [selectedUdid, setSelectedUdid] = useState<string>('');
  const [customUdid, setCustomUdid] = useState<string>('192.168.29.77:46721');
  const [useCustomUdid, setUseCustomUdid] = useState<boolean>(false);
  
  const [minCartValue, setMinCartValue] = useState<number>(400);
  
  const [appPreset, setAppPreset] = useState<string>('dominos_default');
  const [appPackage, setAppPackage] = useState<string>('com.Dominos');
  const [appActivity, setAppActivity] = useState<string>('com.Dominos.activity.alias.LauncherDefaultAlias');
  
  const [couponSource, setCouponSource] = useState<string>('cache');
  const [customCoupons, setCustomCoupons] = useState<string>('PIZZAPARTY, PARTY200, NEW90');
  
  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showGuide, setShowGuide] = useState<boolean>(true);
  const [fetchingDevices, setFetchingDevices] = useState<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const BACKEND_URL = 'http://localhost:5000';

  // Fetch online ADB devices
  const fetchDevices = async () => {
    setFetchingDevices(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/devices`);
      const data = await res.json();
      if (data.success && Array.isArray(data.devices)) {
        setDevices(data.devices);
        if (data.devices.length > 0 && !selectedUdid) {
          setSelectedUdid(data.devices[0]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch devices:', e);
    } finally {
      setFetchingDevices(false);
    }
  };

  useEffect(() => {
    fetchDevices();

    // Connect socket
    const socket = io(BACKEND_URL);
    socketRef.current = socket;

    socket.on('dominos:log', (log: LogEntry) => {
      setLogs((prev) => [...prev, log]);
    });

    socket.on('dominos:status', (event: any) => {
      if (event.type === 'started') {
        setIsRunning(true);
      } else if (event.type === 'finished' || event.type === 'stopped') {
        setIsRunning(false);
      }
    });

    // Check status on mount
    fetch(`${BACKEND_URL}/api/dominos/status`)
      .then((res) => res.json())
      .then((data) => {
        if (data.running) setIsRunning(true);
        if (data.logs) setLogs(data.logs);
      })
      .catch(() => {});

    return () => {
      socket.disconnect();
    };
  }, []);

  // Autoscroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Handle Preset Changes
  const handlePresetChange = (preset: string) => {
    setAppPreset(preset);
    if (preset === 'dominos_default') {
      setAppPackage('com.Dominos');
      setAppActivity('com.Dominos.activity.alias.LauncherDefaultAlias');
    } else if (preset === 'dominos_splash') {
      setAppPackage('com.Dominos');
      setAppActivity('com.Dominos.activity.SplashActivity');
    }
  };

  // Start automation run
  const handleStart = async () => {
    const targetUdid = useCustomUdid ? customUdid.trim() : selectedUdid;
    
    setLogs([{
      message: `🚀 Initiating Appium Domino's Coupon Testing...`,
      type: 'info',
      timestamp: new Date().toLocaleTimeString()
    }]);

    try {
      const res = await fetch(`${BACKEND_URL}/api/dominos/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          udid: targetUdid,
          minCartValue,
          appPackage,
          appActivity,
          couponSource,
          customCoupons: couponSource === 'custom' ? customCoupons : undefined
        })
      });

      const data = await res.json();
      if (!data.success) {
        alert(data.message || 'Failed to start test');
      } else {
        setIsRunning(true);
      }
    } catch (err: any) {
      alert(`Error starting backend automation: ${err.message}`);
    }
  };

  // Stop automation run
  const handleStop = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/dominos/stop`, { method: 'POST' });
      setIsRunning(false);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={styles.container}>
      {/* Header Bar */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>🍕 Domino's Appium Automation Dashboard</h1>
          <p style={styles.subtitle}>Configure mobile test parameters, manage real device connections, and monitor live coupon runs</p>
        </div>
        <div style={styles.statusBadge(isRunning)}>
          <span style={styles.statusDot(isRunning)} />
          {isRunning ? 'Automation Running' : 'Idle / Ready'}
        </div>
      </header>

      {/* Developer Prerequisites Guide Banner */}
      <div style={styles.guideCard}>
        <div style={styles.guideHeader} onClick={() => setShowGuide(!showGuide)}>
          <div style={styles.guideTitleGroup}>
            <span style={{ fontSize: '20px' }}>📱</span>
            <strong>Device Developer Mode Prerequisites & Instructions</strong>
          </div>
          <button style={styles.toggleBtn}>{showGuide ? 'Hide Guide ▲' : 'Show Instructions ▼'}</button>
        </div>

        {showGuide && (
          <div style={styles.guideBody}>
            <p style={{ margin: '0 0 10px 0', color: '#e2e8f0', fontSize: '14px' }}>
              Before launching the test, make sure your Android phone is prepared as follows:
            </p>
            <ol style={styles.guideList}>
              <li>
                <strong>Enable Developer Options:</strong> Open phone <em>Settings ➔ About Phone ➔ Build Number</em> and tap <strong>7 times</strong> until you see <em>"You are now a developer!"</em>.
              </li>
              <li>
                <strong>Enable Wireless Debugging / USB Debugging:</strong> Go to <em>Settings ➔ System / Developer Options</em> and toggle ON <strong>Wireless Debugging</strong> (or USB Debugging).
              </li>
              <li>
                <strong>Pair Device / Copy Connection Port:</strong> On the Wireless Debugging screen, note down your <strong>IP Address & Port</strong> (e.g. <code>192.168.29.77:46721</code>). If not paired, run: <br />
                <code style={styles.codeSnippet}>adb pair &lt;IP&gt;:&lt;PAIRING_PORT&gt; &lt;CODE&gt;</code> then <code style={styles.codeSnippet}>adb connect &lt;IP&gt;:&lt;CONNECT_PORT&gt;</code>
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* Grid Layout */}
      <div style={styles.grid}>
        {/* Left Column: Form Configuration */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>⚙️ Test Configuration</h2>

          {/* Device UDID Selection */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              Target Android Device / UDID
              <button style={styles.refreshBtn} onClick={fetchDevices} disabled={fetchingDevices}>
                {fetchingDevices ? 'Scanning...' : '🔄 Refresh ADB Devices'}
              </button>
            </label>
            
            <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
              <button
                type="button"
                style={styles.tabBtn(!useCustomUdid)}
                onClick={() => setUseCustomUdid(false)}
              >
                Auto-Detected Devices ({devices.length})
              </button>
              <button
                type="button"
                style={styles.tabBtn(useCustomUdid)}
                onClick={() => setUseCustomUdid(true)}
              >
                Manual IP / UDID Entry
              </button>
            </div>

            {!useCustomUdid ? (
              <select
                style={styles.input}
                value={selectedUdid}
                onChange={(e) => setSelectedUdid(e.target.value)}
              >
                {devices.length === 0 && <option value="">No ADB devices detected (Connect via Wi-Fi/USB)</option>}
                {devices.map((d) => (
                  <option key={d} value={d}>
                    📲 {d}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                style={styles.input}
                placeholder="e.g. 192.168.29.77:46721"
                value={customUdid}
                onChange={(e) => setCustomUdid(e.target.value)}
              />
            )}
          </div>

          {/* App Package & Activity Presets */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>App Package & Launcher Activity Preset</label>
            <select
              style={styles.input}
              value={appPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              <option value="dominos_default">Domino's India - LauncherDefaultAlias (Default)</option>
              <option value="dominos_splash">Domino's India - SplashActivity</option>
              <option value="custom">Custom App Package & Activity...</option>
            </select>
          </div>

          {appPreset === 'custom' && (
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>App Package</label>
                <input
                  type="text"
                  style={styles.input}
                  value={appPackage}
                  onChange={(e) => setAppPackage(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>App Activity</label>
                <input
                  type="text"
                  style={styles.input}
                  value={appActivity}
                  onChange={(e) => setAppActivity(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Minimum Cart Value */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Target Minimum Cart Value (₹)</label>
            <input
              type="number"
              style={styles.input}
              value={minCartValue}
              onChange={(e) => setMinCartValue(parseInt(e.target.value || '0', 10))}
              step={50}
              min={0}
            />
          </div>

          {/* Coupon Source */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Coupon Code Source</label>
            <select
              style={styles.input}
              value={couponSource}
              onChange={(e) => setCouponSource(e.target.value)}
            >
              <option value="cache">⚡ Local Cache (13 Coupons from coupons.json)</option>
              <option value="scrape">🌐 Live Web Scraping (Scrape fresh coupons from GrabOn via Playwright)</option>
              <option value="custom">✍️ Custom List (Enter manually below)</option>
            </select>
          </div>

          {couponSource === 'custom' && (
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Custom Coupon Codes (Comma Separated)</label>
              <textarea
                style={{ ...styles.input, height: '70px', resize: 'vertical' }}
                value={customCoupons}
                onChange={(e) => setCustomCoupons(e.target.value)}
                placeholder="e.g. PIZZAPARTY, PARTY200, NEW90"
              />
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button
              style={styles.startBtn(isRunning)}
              onClick={handleStart}
              disabled={isRunning}
            >
              {isRunning ? '⏳ Running Mobile Test...' : '🚀 Start Automation Test'}
            </button>
            
            {isRunning && (
              <button style={styles.stopBtn} onClick={handleStop}>
                🛑 Stop Test
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Live Terminal Console */}
        <div style={styles.card}>
          <div style={styles.consoleHeader}>
            <h2 style={styles.cardTitle}>📟 Live Terminal Console Output</h2>
            <button style={styles.clearBtn} onClick={() => setLogs([])}>
              Clear Terminal
            </button>
          </div>

          <div style={styles.consoleBody}>
            {logs.length === 0 ? (
              <div style={styles.emptyConsole}>
                <span>Console log output will stream here in real time...</span>
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} style={styles.logLine(log.type)}>
                  <span style={styles.logTime}>[{log.timestamp}]</span> {log.message}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

// Styling System
const styles = {
  container: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    minHeight: '100vh',
    padding: '24px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    borderBottom: '1px solid #1e293b',
    paddingBottom: '16px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 700,
    background: 'linear-gradient(to right, #38bdf8, #818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    margin: '4px 0 0 0',
    color: '#94a3b8',
    fontSize: '14px',
  },
  statusBadge: (running: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: running ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
    color: running ? '#4ade80' : '#94a3b8',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: 600,
    border: `1px solid ${running ? '#22c55e' : '#475569'}`,
  }),
  statusDot: (running: boolean) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: running ? '#22c55e' : '#94a3b8',
    boxShadow: running ? '0 0 8px #22c55e' : 'none',
  }),
  guideCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    border: '1px solid #334155',
    marginBottom: '24px',
    overflow: 'hidden',
  },
  guideHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    cursor: 'pointer',
    backgroundColor: '#1e293b',
  },
  guideTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: '#38bdf8',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '13px',
  },
  guideBody: {
    padding: '0 20px 16px 20px',
    borderTop: '1px solid #334155',
    backgroundColor: '#0f172a',
  },
  guideList: {
    margin: 0,
    paddingLeft: '20px',
    color: '#cbd5e1',
    fontSize: '13px',
    lineHeight: '1.7',
  },
  codeSnippet: {
    backgroundColor: '#1e293b',
    color: '#38bdf8',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  cardTitle: {
    margin: '0 0 16px 0',
    fontSize: '17px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  fieldGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#cbd5e1',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f8fafc',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  tabBtn: (active: boolean) => ({
    padding: '6px 12px',
    borderRadius: '6px',
    border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
    backgroundColor: active ? 'rgba(56, 189, 248, 0.15)' : '#0f172a',
    color: active ? '#38bdf8' : '#94a3b8',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  }),
  refreshBtn: {
    background: 'none',
    border: 'none',
    color: '#38bdf8',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  },
  startBtn: (disabled: boolean) => ({
    flex: 1,
    padding: '12px 20px',
    backgroundColor: disabled ? '#334155' : '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '15px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background-color 0.2s',
  }),
  stopBtn: {
    padding: '12px 20px',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '15px',
    cursor: 'pointer',
  },
  consoleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  clearBtn: {
    background: 'none',
    border: '1px solid #334155',
    color: '#94a3b8',
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  consoleBody: {
    backgroundColor: '#020617',
    borderRadius: '8px',
    padding: '14px',
    fontFamily: 'Consolas, Monaco, "Andale Mono", monospace',
    fontSize: '13px',
    height: '420px',
    overflowY: 'auto' as const,
    border: '1px solid #1e293b',
  },
  emptyConsole: {
    color: '#475569',
    textAlign: 'center' as const,
    paddingTop: '180px',
    fontSize: '13px',
  },
  logLine: (type: string) => ({
    marginBottom: '6px',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    color: type === 'error' ? '#f87171' : type === 'success' ? '#4ade80' : '#e2e8f0',
  }),
  logTime: {
    color: '#64748b',
    marginRight: '6px',
  },
};
