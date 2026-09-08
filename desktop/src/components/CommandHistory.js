import React, { useState, useEffect } from 'react';
import '../styles/CommandHistory.css';

function CommandHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadHistory = async () => {
    try {
      const result = await window.electronAPI.getHistory();
      if (result.success) {
        setHistory(result.history || []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading history:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="history loading">Loading history...</div>;
  }

  return (
    <div className="history">
      <h2>Command History</h2>

      {history.length === 0 ? (
        <div className="empty-state">
          <p>📝 No commands recorded yet</p>
          <p className="help-text">Start JARVIS and give some voice commands to see them here</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item, index) => (
            <div key={index} className="history-item">
              <div className="history-header">
                <span className="command-text">
                  <strong>User:</strong> {item.user_input || 'Unknown command'}
                </span>
                <span className="command-time">
                  {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'Unknown time'}
                </span>
              </div>
              <div className="history-response">
                <strong>JARVIS:</strong> {item.bot_response || 'No response recorded'}
              </div>
              {item.skill_used && (
                <div className="history-skill">
                  <span className="skill-badge">{item.skill_used}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      {history.length > 0 && (
        <div className="history-stats">
          <h3>Session Statistics</h3>
          <div className="stats-grid">
            <div className="stat">
              <div className="stat-value">{history.length}</div>
              <div className="stat-label">Total Commands</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {Math.round(
                  history.reduce((sum, item) => {
                    const words = (item.user_input || '').split(' ').length;
                    return sum + words;
                  }, 0) / history.length
                )}
              </div>
              <div className="stat-label">Avg Words/Command</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {new Set(history.map((item) => item.skill_used || 'unknown')).size}
              </div>
              <div className="stat-label">Skills Used</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CommandHistory;
