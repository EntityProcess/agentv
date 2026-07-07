module.exports = class OracleTargetProvider {
  constructor(options = {}) {
    this.label = options.label;
    this.config = options.config || {};
  }

  id() {
    return this.label || 'oracle-target';
  }

  async callApi(_prompt, context = {}) {
    const vars = context.vars || {};
    const prefix = this.config.prefix || this.label || 'TARGET';
    return {
      output: `${prefix}:${vars.case_id}`,
    };
  }
};
