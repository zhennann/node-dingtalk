'use strict';

/**
 * 业务事件回调相关 API
 * @type {Department}
 */
module.exports = class Callback {
  constructor(client, options) {
    this.client = client;
    this.options = options;
  }

  async register_call_back(opts) {
    return this.client.get('call_back/register_call_back', opts);
  }

  async get_call_back(opts) {
    return this.client.get('call_back/get_call_back', opts);
  }

  async update_call_back(opts) {
    return this.client.get('call_back/update_call_back', opts);
  }

  async delete_call_back(opts) {
    return this.client.get('call_back/delete_call_back', opts);
  }

};
