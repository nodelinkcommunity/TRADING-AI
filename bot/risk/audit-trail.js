/**
 * FLASHLOAN-AI: Audit Trail
 * Logs every AI/Risk decision with full context for review and learning.
 */

const fs = require("fs");
const path = require("path");

class AuditTrail {
  constructor() {
    this.records = [];
    this.maxRecords = 5000;
    this.filePath = path.join(__dirname, "..", "..", "server", "data", "audit-trail.json");
    this.saveInterval = null;
    this.dirty = false;
  }

  initialize() {
    this._loadFromDisk();

    // Auto-save every 30 seconds if dirty
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this._saveToDisk();
        this.dirty = false;
      }
    }, 30000);

    console.log(`[AuditTrail] Initialized with ${this.records.length} existing records`);
  }

  /**
   * Record a decision/event
   * @param {object} entry - { type, opportunity, assessment, marketSummary, timestamp }
   */
  record(entry) {
    this.records.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...entry,
      timestamp: entry.timestamp || Date.now(),
    });

    // Trim oldest records
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    this.dirty = true;
  }

  /**
   * Get recent records
   * @param {number} count - Number of records to return
   * @param {string} type - Optional filter by type
   */
  getRecent(count = 20, type = null) {
    let filtered = this.records;
    if (type) {
      filtered = filtered.filter((r) => r.type === type);
    }
    return filtered.slice(-count);
  }

  /**
   * Get records within a time range
   */
  getRange(startTime, endTime) {
    return this.records.filter(
      (r) => r.timestamp >= startTime && r.timestamp <= endTime
    );
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const typeCounts = {};
    for (const record of this.records) {
      typeCounts[record.type] = (typeCounts[record.type] || 0) + 1;
    }

    const last24h = this.records.filter(
      (r) => r.timestamp > Date.now() - 86400000
    );
    const allowed = last24h.filter((r) => r.assessment?.allowed === true).length;
    const blocked = last24h.filter((r) => r.assessment?.allowed === false).length;

    return {
      totalRecords: this.records.length,
      typeCounts,
      last24h: {
        total: last24h.length,
        allowed,
        blocked,
        blockRate: last24h.length > 0 ? (blocked / last24h.length * 100).toFixed(1) + "%" : "0%",
      },
    };
  }

  /**
   * Query records by criteria
   */
  query({ type, minRiskScore, fromTime, toTime, limit = 50 }) {
    let results = this.records;

    if (type) results = results.filter((r) => r.type === type);
    if (minRiskScore) results = results.filter((r) => (r.assessment?.riskScore || 0) >= minRiskScore);
    if (fromTime) results = results.filter((r) => r.timestamp >= fromTime);
    if (toTime) results = results.filter((r) => r.timestamp <= toTime);

    return results.slice(-limit);
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf8");
        this.records = JSON.parse(data);
        if (!Array.isArray(this.records)) this.records = [];
      }
    } catch (error) {
      console.warn(`[AuditTrail] Load error: ${error.message}`);
      this.records = [];
    }
  }

  _saveToDisk() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), "utf8");
    } catch (error) {
      console.warn(`[AuditTrail] Save error: ${error.message}`);
    }
  }

  shutdown() {
    if (this.saveInterval) clearInterval(this.saveInterval);
    if (this.dirty) this._saveToDisk();
  }
}

module.exports = AuditTrail;
