'use strict';

const assert = require('assert');

/**
 * 企业消息相关 API
 * @type {Message}
 */
module.exports = class Message {
  constructor(client, options) {
    this.client = client;
    this.options = options;
  }

  /**
   * 发送企业消息
   *  - message/send
   *
   * @param {Object} opts - 消息内容 { touser, toparty, msgtype, ... }
   *  - touser {String} 目标用户, 多个用 | 分隔, 全部用 `@all`
   *  - toparty {String} 目标部门, 多个用 | 分隔
   *  - msgtype {String} 消息类型
   *  - text/image/voice/file/link/oa {Object} 对应的消息体
   * @return {Object} 操作结果 { messageId, ... }
   *
   * @see https://open-doc.dingtalk.com/doc2/detail.htm?treeId=172&articleId=104973&docType=1
   * @see https://open-doc.dingtalk.com/doc2/detail.htm?treeId=172&articleId=104972&docType=1
   */
  async send(opts) {
    assert(opts.touser || opts.toparty, 'options touser or toparty required');
    assert(opts.msgtype, 'options.msgtype required');
    assert(opts.agentid, 'options.agentid required');
    assert(opts[opts.msgtype], `options.${opts.msgtype} required`);
    return this.client.post('message/send', opts);
  }

  /**
   * 获取企业会话消息已读未读状态
   *  - message/list_message_status
   *
   * @param {String} messageId - 消息ID
   * @return {Object} 消息状态 { read: [userid, ...], unread: [] }
   */
  async listMessageStatus(messageId) {
    assert(messageId, 'messageId required');
    return this.client.post('message/list_message_status', { messageId });
  }

  /**
   * 发送工作通知消息
   *  - topapi/message/corpconversation/asyncsend_v2
   *
   * @param {Number} agent_id
   * @param {String} userid_list 多个用逗号分隔
   * @param {String} dept_id_list 多个用逗号分隔
   * @param {Boolean} to_all_user
   * @param {Object} msg
   * @return {Object} 操作结果 { task_id }
   */
  async sendMessage(opts) {
    assert(opts.agent_id, 'opts.agent_id required');
    assert(opts.userid_list || opts.dept_id_list || opts.to_all_user, 'opts.userid_list or opts.dept_id_list or opts.to_all_user required');
    assert(opts.msg, 'opts.msg required');
    return this.client.post('topapi/message/corpconversation/asyncsend_v2', opts);
  }

  /**
   * 查询工作通知消息的发送进度
   *  - topapi/message/corpconversation/getsendprogress
   * @param {Number} agent_id
   * @param {Number} task_id
   * @return {Object} 操作结果 { progress }
   */
  async getSendProgress(opts) {
    assert(opts.agent_id, 'opts.agent_id required');
    assert(opts.task_id, 'opts.task_id required');
    return this.client.post('topapi/message/corpconversation/getsendprogress', opts);
  }

  /**
   * 查询工作通知消息的发送结果
   *  - topapi/message/corpconversation/getsendresult
   * @param {Number} agent_id
   * @param {Number} task_id
   * @return {Object} 操作结果 { send_result }
   */
  async getSendResult(opts) {
    assert(opts.agent_id, 'opts.agent_id required');
    assert(opts.task_id, 'opts.task_id required');
    return this.client.post('topapi/message/corpconversation/getsendresult', opts);
  }

  /**
   * 工作通知消息撤回
   *  - topapi/message/corpconversation/recall
   * @param {Number} agent_id
   * @param {Number} msg_task_id
   * @return {Object} 操作结果 { }
   */
  async recallMessage(opts) {
    assert(opts.agent_id, 'opts.agent_id required');
    assert(opts.msg_task_id, 'opts.msg_task_id required');
    return this.client.post('topapi/message/corpconversation/recall', opts);
  }

};
