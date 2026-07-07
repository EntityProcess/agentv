module.exports = class OracleGraderProvider {
  constructor(options = {}) {
    this.label = options.label;
    this.config = options.config || {};
  }

  id() {
    return this.label || 'oracle-grader';
  }

  async callApi() {
    const label = this.config.grade_label || this.config.gradeLabel || this.label || 'unknown';
    return {
      output: JSON.stringify({
        pass: true,
        score: 1,
        reason: `graded-by:${label}`,
      }),
    };
  }
};
