import React, { useState, useEffect } from 'react';
import '../styles/Settings.css';

function Settings() {
  const [config, setConfig] = useState({
    voice: 'Samantha',
    tts_rate: 160,
    wake_word: 'jarvis',
    user_name: 'Boss',
    timezone: 'Asia/Kolkata',
    skills: {
      web_search: true,
      coding_assistant: true,
      conversation: true,
    },
  });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const result = await window.electronAPI.getConfig();
      if (result.success) {
        setConfig(result.config);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading config:', error);
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value,
    }));
    setSaved(false);
  };

  const handleSkillToggle = (skill) => {
    setConfig((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [skill]: !prev.skills[skill],
      },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      const result = await window.electronAPI.saveConfig(config);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        alert('Failed to save configuration: ' + result.message);
      }
    } catch (error) {
      console.error('Error saving config:', error);
      alert('Error saving configuration');
    }
  };

  if (loading) {
    return <div className="settings loading">Loading settings...</div>;
  }

  return (
    <div className="settings">
      <h2>JARVIS Settings</h2>

      {/* Voice Settings */}
      <div className="settings-section">
        <h3>🎤 Voice Settings</h3>
        <div className="setting-group">
          <label>Voice Name</label>
          <select
            value={config.voice}
            onChange={(e) => handleChange('voice', e.target.value)}
          >
            <option value="Samantha">Samantha (Default)</option>
            <option value="Alex">Alex</option>
            <option value="Alice">Alice</option>
            <option value="Victoria">Victoria</option>
            <option value="Daniel">Daniel</option>
            <option value="Moira">Moira</option>
            <option value="Fiona">Fiona</option>
          </select>
          <p className="help-text">Choose your preferred voice for TTS</p>
        </div>

        <div className="setting-group">
          <label>
            Speech Speed: {config.tts_rate}
            <input
              type="range"
              min="100"
              max="200"
              value={config.tts_rate}
              onChange={(e) => handleChange('tts_rate', parseInt(e.target.value))}
            />
          </label>
          <p className="help-text">100 = slower (more natural), 200 = faster</p>
        </div>
      </div>

      {/* Wake Word Settings */}
      <div className="settings-section">
        <h3>🎯 Wake Word</h3>
        <div className="setting-group">
          <label>Wake Word</label>
          <input
            type="text"
            value={config.wake_word}
            onChange={(e) => handleChange('wake_word', e.target.value.toLowerCase())}
            placeholder="e.g., jarvis, hi, hey"
          />
          <p className="help-text">
            Word to activate JARVIS. Restart JARVIS after changing.
          </p>
        </div>
      </div>

      {/* Personal Settings */}
      <div className="settings-section">
        <h3>👤 Personal Settings</h3>
        <div className="setting-group">
          <label>Your Name</label>
          <input
            type="text"
            value={config.user_name}
            onChange={(e) => handleChange('user_name', e.target.value)}
            placeholder="Your name"
          />
          <p className="help-text">JARVIS will use this to address you</p>
        </div>

        <div className="setting-group">
          <label>Timezone</label>
          <input
            type="text"
            value={config.timezone}
            onChange={(e) => handleChange('timezone', e.target.value)}
            placeholder="e.g., Asia/Kolkata"
          />
          <p className="help-text">Your timezone for time-based commands</p>
        </div>
      </div>

      {/* Skill Settings */}
      <div className="settings-section">
        <h3>🧠 Skills</h3>
        <div className="skills-list">
          <div className="skill-toggle">
            <label>
              <input
                type="checkbox"
                checked={config.skills?.web_search || false}
                onChange={() => handleSkillToggle('web_search')}
              />
              <span>Web Search</span>
            </label>
            <p className="help-text">Search the internet in real-time</p>
          </div>

          <div className="skill-toggle">
            <label>
              <input
                type="checkbox"
                checked={config.skills?.coding_assistant || false}
                onChange={() => handleSkillToggle('coding_assistant')}
              />
              <span>Coding Assistant</span>
            </label>
            <p className="help-text">Expert programming help for all languages</p>
          </div>

          <div className="skill-toggle">
            <label>
              <input
                type="checkbox"
                checked={config.skills?.conversation || false}
                onChange={() => handleSkillToggle('conversation')}
              />
              <span>Conversation</span>
            </label>
            <p className="help-text">General chat and discussion</p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="settings-actions">
        <button className="save-btn" onClick={handleSave}>
          💾 Save Settings
        </button>
        {saved && <p className="save-success">✓ Settings saved successfully!</p>}
      </div>

      {/* Info Box */}
      <div className="info-box">
        <h4>💡 Tips</h4>
        <ul>
          <li>Restart JARVIS after changing the wake word</li>
          <li>Lower speech speed (100-140) sounds more natural</li>
          <li>Disable skills you don't use to save resources</li>
          <li>Settings are stored in ~/.jarvis/config.json</li>
        </ul>
      </div>
    </div>
  );
}

export default Settings;
