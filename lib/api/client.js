'use strict';

const assert = require('assert');
const Url = require('url');
const querystring = require('querystring');
const crypto = require('crypto');
const Agent = require('agentkeepalive');
const HttpsAgent = require('agentkeepalive').HttpsAgent;
const FormStream = require('formstream');
const urllib = require('urllib');

const URLLIB = Symbol('URLLIB');

const AccessToken = require('./access-token');
const Ticket = require('./ticket');

/**
 * 鉴权 && 请求相关 API
 * @type {Client}
 */
module.exports = class Client {
  /**
   * Client 构造函数
   * @param {Object} options 配置参数
   *  - {String} appkey - appkey
   *  - {String} appsecret - appsecret
   *  - {String} host - 钉钉服务接口地址
   *  - {Object} [requestOpts] - urllib 默认请求参数
   * @class
   */
  constructor(options, getToken, saveToken) {
    assert(options.appkey, 'options.appkey required');
    assert(options.appsecret, 'options.appsecret required');
    assert(options.host, 'options.host required');

    this.options = options;

    this.getToken = getToken || async function() {
      return this.store;
    };
    this.saveToken = saveToken || async function(token) {
      this.store = token;
      if (process.env.NODE_ENV === 'production') {
        console.warn('Don\'t save token in memory, when cluster or multi-computer!');
      }
    };

    // set default js ticket handle
    this.registerTicketHandle();
  }

  registerTicketHandle(getTicketToken, saveTicketToken) {
    if (!getTicketToken && !saveTicketToken) this.ticketStore = {}; // 初始化

    this.getTicketToken = getTicketToken || async function(type) {
      return this.ticketStore[type];
    };
    this.saveTicketToken = saveTicketToken || async function(type, ticketToken) {
      this.ticketStore[type] = ticketToken;

      if (process.env.NODE_ENV === 'production') {
        console.warn('Dont save ticket in memory, when cluster or multi-computer!');
      }
    };
  }

  /**
   * 返回 option.urlib 实例或者根据配置初始化一个
   * @return {Object} urlib 实例
   * @see https://www.npmjs.com/package/urllib
   */
  get urllib() {
    if (!this[URLLIB]) {
      // 直接传递 urllib 实例
      if (this.options.urllib && this.options.urllib.request) {
        this[URLLIB] = this.options.urllib;
      } else {
        // urllib 配置
        const opts = Object.assign({
          keepAlive: true,
          keepAliveTimeout: 30000,
          timeout: 30000,
          maxSockets: Infinity,
          maxFreeSockets: 256,
        }, this.options.urllib);

        this[URLLIB] = urllib.create({
          agent: new Agent(opts),
          httpsAgent: new HttpsAgent(opts),
        });
      }
    }
    return this[URLLIB];
  }

  /**
   * send http request
   * @param {String} url 请求地址
   * @param {Object} [opts] 请求参数
   * @return {Object} 返回结果的 data
   */
  async request(url, opts) {
    const requestOpts = Object.assign({ dataType: 'json' }, this.options.requestOpts, opts);

    const params = (requestOpts && requestOpts.params) || {};
    const ignoreAccessToken = requestOpts && requestOpts.ignoreAccessToken;
    if (!ignoreAccessToken) {
      let accessToken = requestOpts && requestOpts.accessToken;
      if (!accessToken) {
        accessToken = await this.getAccessToken();
      }
      params.access_token = accessToken;
    }

    url = `${url}?${querystring.stringify(params)}`;
    delete requestOpts.params;
    delete requestOpts.ignoreAccessToken;
    delete requestOpts.accessToken;

    // 如果有配置代理，则设置代理信息
    if (this.options.proxy) {
      url = url.replace(this.options.host, this.options.proxy);
    }

    let response;
    try {
      response = await this.urllib.request(url, requestOpts);
    } catch (err) {
      if (this.options.logger) {
        this.options.logger.warn('[node-dingtalk:client:request:error] %s %s %s, headers: %j, error: %j',
          requestOpts.method || 'GET', url, err.status, err.headers, err);
      }
      throw err;
    }

    const result = response.data;
    if (this.options.logger) {
      this.options.logger.info('[node-dingtalk:client:request:response] %s %s %s, headers: %j, result: %j',
        requestOpts.method || 'GET', url, response.status, response.headers, result);
    }
    if (result) {
      if (result.errcode !== 0) {
        const err = new Error(`${url} got error: ${JSON.stringify(result)}`);
        err.name = 'DingTalkClientResponseError';
        err.code = result.errcode;
        err.data = result;
        throw err;
      } else {
        return result;
      }
    } else {
      return response;
    }
  }

  /**
   * upload file
   * @param {String} url 请求地址
   * @param {Object} fileInfo 文件信息 { field, path }
   * @param {Object} [fields] 其他信息
   * @return {Object} 操作结果
   */
  async upload(url, fileInfo, fields) {
    assert(fileInfo.field, 'fileInfo.field required');
    assert(fileInfo.path, 'fileInfo.path required');

    const form = FormStream();
    if (fields) {
      for (const key of Object.keys(fields)) {
        form.field(key, fields[key]);
      }
    }
    form.file(fileInfo.field, fileInfo.path);

    return this.request(url, {
      method: 'POST',
      headers: form.headers(),
      stream: form,
    });
  }

  /**
   * send GET request to dingtalk
   * @param {String} api - api name, not need start with `/`
   * @param {Object} [params] - query object
   * @param {Object} [opts] - urllib opts
   * @return {Object} response.data
   */
  async get(api, params, opts) {
    assert(api, 'api path required');
    const url = `${this.options.host}/${api}`;
    return this.request(url, Object.assign({
      params,
    }, opts));
  }

  /**
   * send POST request to dingtalk
   * @param {String} api - api name, not need start with `/`
   * @param {Object} [data] - post body object
   * @param {Object} [opts] - urllib opts
   * @return {Object} response.data
   */
  async post(api, data, opts) {
    assert(api, 'api path required');
    const url = `${this.options.host}/${api}`;
    return this.request(url, Object.assign({
      method: 'POST',
      contentType: 'json',
      data,
    }, opts));
  }

  /**
   * 获取网站应用钉钉扫码登录 URL，用于网站本身偷懒不想单独做一个登录页面的情况
   * https://open-doc.dingtalk.com/docs/doc.htm?treeId=168&articleId=104882&docType=1
   * @param {Object} [query] - qrconnect url params
   * @param {String} [query.appid] - 钉钉应用 id
   * @param {String} [query.redirect_uri] - 登录成功后的回跳 URL，必须跟钉钉应用后台配置的一致
   * @return {String} qrconnect url
   */
  async getQRConnectUrl(query) {
    const params = Object.assign({
      response_type: 'code',
      scope: 'snsapi_login',
      state: 'STATE',
      appid: this.options.appkey, // 必填
      redirect_uri: this.options.redirect_uri, // 必填
    }, query);
    return `${this.options.host}/connect/qrconnect?${querystring.stringify(params)}`;
  }

  /**
   * 获取 iframe 形式内嵌二维码的登录 goto
   * https://open-doc.dingtalk.com/docs/doc.htm?treeId=168&articleId=104882&docType=1
   * @param {Object} [query] - qrconnect url params
   * @param {String} [query.appid] - 钉钉应用 id
   * @param {String} [query.redirect_uri] - 登录成功后的回跳 URL，必须跟钉钉应用后台配置的一致
   * @return {String} qrconnect url
   */
  async getIframeQRGotoUrl(query) {
    const params = Object.assign({
      response_type: 'code',
      scope: 'snsapi_login',
      state: 'STATE',
      appid: this.options.appkey, // 必填
      redirect_uri: this.options.redirect_uri, // 必填
    }, query);
    return `${this.options.host}/connect/oauth2/sns_authorize?${querystring.stringify(params)}`;
  }

  /**
   * 如果钉钉用户通过钉钉客户端访问你的H5应用时，则需要由你构造并引导用户跳转到如下链接。
   * https://open-doc.dingtalk.com/docs/doc.htm?treeId=168&articleId=104881&docType=1
   * @param {Object} [query] - qrconnect url params
   * @param {String} [query.appid] - 钉钉应用 id
   * @param {String} [query.redirect_uri] - 登录成功后的回跳 URL，必须跟钉钉应用后台配置的一致
   * @return {String} qrconnect url
   */
  async getWebAuthUrl(query) {
    const params = Object.assign({
      response_type: 'code',
      scope: 'snsapi_auth',
      state: 'STATE',
      appid: this.options.appkey, // 必填
      redirect_uri: this.options.redirect_uri, // 必填
    }, query);
    return `${this.options.host}/connect/oauth2/sns_authorize?${querystring.stringify(params)}`;
  }

  /**
   * 钉钉用户访问你的Web系统时，如果用户选择使用钉钉账号登录，则需要由你构造并引导用户跳转到如下链接。
   * https://open-doc.dingtalk.com/docs/doc.htm?treeId=168&articleId=104881&docType=1
   * @param {Object} [query] - qrconnect url params
   * @param {String} [query.appid] - 钉钉应用 id
   * @param {String} [query.redirect_uri] - 登录成功后的回跳 URL，必须跟钉钉应用后台配置的一致
   * @return {String} qrconnect url
   */
  async getWebLoginUrl(query) {
    const params = Object.assign({
      response_type: 'code',
      scope: 'snsapi_login',
      state: 'STATE',
      appid: this.options.appkey, // 必填
      redirect_uri: this.options.redirect_uri, // 必填
    }, query);
    return `${this.options.host}/connect/oauth2/sns_authorize?${querystring.stringify(params)}`;
  }

  /**
   * 获取 iframe goto 成功后的最终跳转验证 URL
   * https://open-doc.dingtalk.com/docs/doc.htm?treeId=168&articleId=104882&docType=1
   * @param {Object} query - qrconnect url params
   * @param {String} query.loginTmpCode - 一次性临时登录验证 code
   * @param {String} [query.appid] - 钉钉应用 id
   * @param {String} [query.redirect_uri] - 登录成功后的回跳 URL，必须跟钉钉应用后台配置的一致
   * @return {String} qrconnect url
   */
  async getSnsAuthorizeUrl(query) {
    assert(query && query.loginTmpCode, 'loginTmpCode required');
    const params = Object.assign({
      response_type: 'code',
      scope: 'snsapi_login',
      state: 'STATE',
      appid: this.options.appkey, // 必填
      redirect_uri: this.options.redirect_uri, // 必填
    }, query);
    return `${this.options.host}/connect/oauth2/sns_authorize?${querystring.stringify(params)}`;
  }

  async getPersistentCode(accessToken, tmpAuthCode) {
    // accessToken 必须是 appid 获取的 accessToken
    const data = {
      tmp_auth_code: tmpAuthCode,
    };
    return this.post('sns/get_persistent_code', data, { accessToken });
  }

  async getSnsToken(accessToken, openid, persistentCode) {
    // accessToken 必须是 appid 获取的 accessToken
    const data = {
      openid,
      persistent_code: persistentCode,
    };
    return this.post('sns/get_sns_token', data, { accessToken });
  }

  async getSnsUserInfo(accessToken, snsToken) {
    // accessToken 必须是 appid 获取的 accessToken
    const data = {
      sns_token: snsToken,
    };
    return this.get('sns/getuserinfo', data, { accessToken });
  }

  async getUserInfo(accessToken, userid) {
    return this.get('user/get', { userid }, { accessToken });
  }

  async getSSOUserInfo(accessToken, code) {
    const data = {
      code,
    };
    return this.get('sso/getuserinfo', data, { accessToken });
  }

  async getuserinfo_bycode(tmp_auth_code) {
    const timestamp = Date.now();
    const params = {
      accessKey: this.options.appkey,
      timestamp,
      signature: this.signatureHmac(timestamp + '', this.options.appsecret, 'sha256', 'base64'),
    };
    const data = {
      tmp_auth_code,
    };
    return this.post('sns/getuserinfo_bycode', data, { params, ignoreAccessToken: true });
  }

  /**
   * 获取 AccessToken, 并在有效期内自动缓存
   * - gettoken
   * @param {Object} [options] - 可以通过 appid 获取，也可以通过 corpid 获取
   * @return {String} accessToken
   */
  async getAccessToken() {
    // 调用用户传入的获取token的异步方法，获得token之后使用（并缓存它）。
    const token = await this.getToken();
    if (token && (new AccessToken(token.accessToken, token.expireTime)).isValid()) {
      return token.accessToken;
    }

    // 获取accesstoken
    const appkey = this.options.appkey;
    const appsecret = this.options.appsecret;
    let url;
    let data;
    if (this.options.sso) {
      url = 'sso/gettoken';
      data = { corpid: appkey, corpsecret: appsecret };
    } else {
      url = 'gettoken';
      data = { appkey, appsecret };
    }
    const response = await this.get(url, data, { ignoreAccessToken: true });
    const accessToken = response.access_token;
    const expires_in = response.expires_in;

    // 过期时间，因网络延迟等，将实际过期时间提前10秒，以防止临界点
    const expireTime = (new Date().getTime()) + (expires_in - 10) * 1000;
    await this.saveToken({ accessToken, expireTime });

    return accessToken;
  }

  /**
   * 获取 jsapi_ticket, 并在有效期内自动缓存
   *  - get_jsapi_ticket
   * @return {String} jsapiTicket
   * @see https://open-doc.dingtalk.com/doc2/detail.htm?treeId=172&articleId=104966&docType=1
   */
  async getJSApiTicket(type) {
    type = type || 'jsapi';
    // 调用用户传入的获取token的异步方法，获得token之后使用（并缓存它）。
    const ticketToken = await this.getTicketToken(type);
    if (ticketToken && (new Ticket(ticketToken.ticket, ticketToken.expireTime)).isValid()) {
      return ticketToken.ticket;
    }

    // 获取ticket
    const response = await this.get('get_jsapi_ticket', { type });
    const ticket = response.ticket;
    const expires_in = response.expires_in;

    // 过期时间，因网络延迟等，将实际过期时间提前10秒，以防止临界点
    const expireTime = (new Date().getTime()) + (expires_in - 10) * 1000;
    await this.saveTicketToken(type, { ticket, expireTime });

    return ticket;
  }

  /**
   * 对签名用的 url 做处理
   *  - 干掉 hash
   *  - query 参数需要做 url decode, 不能包含 %2F 等
   * @param {String} url 需转换的 url
   * @return {String} 转换后的 url
   * @private
   * @see https://open-doc.dingtalk.com/doc2/detail.htm?spm=a219a.7386797.0.0.WXYE3B&treeId=171&articleId=104934&docType=1
   */
  _normalizeUrl(url) {
    // url 处理, 干掉 hash, query 需做 url decode
    const originUrlObj = Url.parse(url, true);
    const queryStr = Object.keys(originUrlObj.query).reduce((result, key) => {
      const value = originUrlObj.query[key];
      result.push(`${key}=${(value)}`);
      return result;
    }, []).join('&');
    delete originUrlObj.hash;
    delete originUrlObj.query;
    delete originUrlObj.search;
    return Url.format(originUrlObj) + (queryStr ? '?' + queryStr : '');
  }

  /**
   * 获取 js api 接入时需要的配置数据
   * @param {String} url 当前页面的地址 (注意: egg 里面是 `this.href`)
   * @param {Object} [opts] 其他参数, 包括 noncestr, timestamp
   * @return {Object} 配置, 前端还需要单独配置 agentId 和 jsApiList
   * @see https://open-doc.dingtalk.com/doc2/detail.htm?spm=a219a.7386797.0.0.WXYE3B&treeId=171&articleId=104934&docType=1
   */
  async getJSApiConfig(url, opts) {
    const ticket = await this.getJSApiTicket();
    const signObj = Object.assign({
      jsapi_ticket: ticket,
      noncestr: 'DingTalk#' + Date.now(),
      timestamp: Date.now(),
      url: this._normalizeUrl(url),
    }, opts);

    const signContent = Object.keys(signObj).sort().map(key => `${key}=${signObj[key]}`);
    const sha1 = crypto.createHash('sha1');
    sha1.update(signContent.join('&'), 'utf8');
    const signature = sha1.digest('hex');

    return {
      corpId: this.options.corpid,
      timeStamp: signObj.timestamp,
      nonceStr: signObj.noncestr,
      signature,
    };
  }

  signatureHmac(str, secret, hash = 'sha256', encoding = 'hex') {
    return crypto.createHmac(hash, secret).update(str).digest(encoding);
  }

  signatureHash(str, secret, hash = 'sha1', encoding = 'hex') {
    return crypto.createHash(hash).update(str).digest(encoding);
  }

};
