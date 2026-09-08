import React, { useState, useEffect } from 'react';
import '../styles/Logs.css';

function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadLogs();
    if (autoRefresh) {
      const interval = setInterval(loadLogs, 2000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const loadLogs = async () => {
    try {
      const result = await window.electronAPI.getLogs();
      if (result.success) {
        setLogs(result.logs || []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading logs:', error);
      setLoading(false);
    }
  };

  const getLogLevel = (line) => {
    if (!line) return 'info';
    const upper = line.toUpperCase();
    if (upper.includes('ERROR')) return 'error';
    if (upper.includes('WARNING')) return 'warning';
    if (upper.includes('INFO')) return 'info';
    if (upper.includes('DEBUG')) return 'debug';
    return 'info';
  };

  return (
    <div className="logs">
      <div className="logs-header">
        <h2>JARVIS Logs</h2>
        <div className="logs-controls">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button onClick={loadLogs} className="refresh-btn">
            🔄 Refresh
          </button>
        </div>
      </div>

      {loading && logs.length === 0 ? (
        <div className="loading">Loading logs...</div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <p>📋 No logs available</p>
          <p className="help-text">Start JARVIS to see activity logs</p>
        </div>
      ) : (
        <div className="logs-container">
          <div className="logs-list">
            {logs.map((line, index) => (
              <div key={index} className={`log-line ${getLogLevel(line)}`}>
                <span className="log-level">{getLogLevel(line).toUpperCase()}</span>
                <span className="log-text">{line || '(empty line)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log Info */}
      <div className="logs-info">
        <h4>📊 Log Information</h4>
        <ul>
          <li>
            <strong>Total entries:</strong> {logs.length}
          </li>
          <li>
            <strong>Location:</strong> data/logs/jarvis.log
          </li>
          <li>
            <strong>Auto-refresh:</strong> {autoRefresh ? 'ON (2s interval)' : 'OFF'}
          </li>
          <li>
            <strong>Showing:</strong> Last 50 log lines
          </li>
        </ul>
      </div>

      {/* Log Legend */}
      <div className="logs-legend">
        <h4>Log Levels</h4>
        <div className="legend-items">
          <div className="legend-item">
            <span className="legend-dot error"></span>
            <span>ERROR - Critical issues</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot warning"></span>
            <span>WARNING - Potential issues</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot info"></span>
            <span>INFO - General information</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot debug"></span>
            <span>DEBUG - Detailed diagnostic info</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Logs;
