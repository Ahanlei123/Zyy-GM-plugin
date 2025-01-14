import plugin from '../../../lib/plugins/plugin.js'
import http from 'http'
import Yaml from 'yaml'
import fs from 'fs'
import crypto from 'crypto'
import { commands } from './rule.js'
import { getmode, getserver, getuid, getScenes } from './index.js'
let _path = process.cwd() + '/plugins/Zyy-GM-plugin/resources/hk4e'

export class hk4e extends plugin {
  constructor() {
    super({
      name: 'hk4e-GM',
      dsc: 'hk4e-游戏指令',
      event: 'message',
      priority: -100,
      rule: commands
    })
  }

  async GM命令(e) {
    e.reply([segment.at(e.user_id), `请等待执行完毕，禁止重复输入！`]);
    const maxRetries = 3;
    let retries = 0;
    let disposition;
    let result = null;

    const { mode } = await getmode(e);
    const { uid } = await getuid(e);
    if (mode === false || mode === undefined) {
      console.log(`重试请求已停止，因为GM的状态为 ${mode}。`);
      return;
    } else if (uid === undefined) {
      console.log(`此用户未绑定UID，已停止重试`);
      return;
    }

    while (retries < maxRetries) {
      try {
        disposition = await makeRequest();
        if (disposition) {
          result = disposition;
          break;
        }
      } catch (error) {
        console.error(`第 ${retries + 1} 次请求失败：${error.message}`);
        e.reply(`请求失败->正在重试->(${retries + 1} / ${maxRetries})`);
      }
      retries++;
      if (retries === maxRetries) {
        e.reply([segment.at(e.user_id), '请求全部失败，请检查你的在线状态、UID是否正确']);
      }
    }


    async function makeRequest() {
      const { ip, port, region, sign, ticketping } = await getserver(e)
      const { mode } = await getmode(e)
      const { value } = await getScenes(e)

      if (mode === true) {
        const data = Yaml.parse(fs.readFileSync(_path + '/data.yaml', 'utf8'));
        let command
        const newmsg = e.msg.slice(1)
        for (const key in data) {
          if (key === newmsg) {
            command = data[key];
            command.length = data[key].length;
            break;
          }
        }
        if (!command) {
          command = newmsg;
        }
        const { uid } = await getuid(e)

        return new Promise((resolve, reject) => {
          const options = {
            host: ip,
            port: port,
            method: 'GET',
            headers: {
              'Host': `${ip}:${port}`
            },
            timeout: 1000
          };
          const responses = [];
          const sendRequest = (item) => {
            setTimeout(() => {
              const encodedItem = item;
              const handleResponse = (res) => {
                res.setEncoding('utf8');

                let rawData = [];
                res.on('data', (chunk) => {
                  rawData.push(Buffer.from(chunk));
                });

                res.on('end', () => {
                  console.log(`完整响应主体: ${rawData}`);
                  try {
                    const disposition = JSON.parse(Buffer.concat(rawData).toString('utf-8'))
                    const retcode = disposition.retcode
                    if (retcode === 0) {
                      const datamsg = disposition.data.msg;
                      responses.push(`成功：${datamsg}  ->  ${uid}`);
                    }
                    else if (retcode === -1) {
                      const datamsg = disposition.data.msg;
                      const dataret = disposition.data.retmsg.replace(/can't find gm command/g, '找不到GM命令').replace(/command/g, '命令').replace(/execute fails/g, '执行失败').replace(/invalid param/g, '无效参数');
                      responses.push(`失败：${datamsg} -> ${uid}\n原因：${dataret}`);
                    }
                    else if (retcode === 4) {
                      responses.push(`又不在线，再发我顺着网线打死你！╭(╯^╰)╮`);
                    }
                    else if (retcode === 617) {
                      const datamsg = disposition.data.msg;
                      responses.push(`失败：${datamsg}  ->  ${uid}\n原因：数量超出限制`);
                    }
                    else if (retcode === 627) {
                      const datamsg = disposition.data.msg;
                      responses.push(`失败：${datamsg}  ->  ${uid}\n原因：数量超出限制`);
                    }
                    else if (retcode === 1003) {
                      responses.push(`失败，服务器验证签名错误`);
                    }
                    else if (retcode === 1010) {
                      responses.push(`失败，服务器区服不匹配`);
                    }
                    else {
                      responses.push(`失败 -> 请把此内容反馈给作者\n反馈内容：[msg:${disposition.data.msg} retcode:${disposition.retcode}`)
                    }
                    if (command === newmsg) {
                      e.reply([segment.at(e.user_id), `\n${responses}`]);
                      return
                    }
                    if (responses.length === command.length) {
                      let responseStr = '';
                      for (let i = 0; i < responses.length; i++) {
                        responseStr += responses[i];
                        if (i !== responses.length - 1) {
                          responseStr += '\n\n';
                        }
                      }
                      e.reply([segment.at(e.user_id), `\n`, responseStr]);
                    } else {
                      return
                    }
                    // ======================================================
                    resolve(disposition)
                    return
                  } catch (error) {
                    reject(`解析响应数据时出错：${error.message}`);
                  }

                });
              };

              const signingkey = {
                cmd: '1116',
                uid: uid,
                region: region,
                msg: encodedItem,
                ticket: ticketping
              };
              const sortedParams = Object.keys(signingkey)
                .sort()
                .map(key => `${key}=${signingkey[key]}`)
                .join('&');
              const signStr = sortedParams + sign;
              const newsign = `&sign=` + crypto.createHash('sha256').update(signStr).digest('hex')

              options.path = `/api?cmd=1116&uid=${uid}&region=${region}&msg=${encodeURIComponent(encodedItem)}&ticket=${ticketping}${newsign}`



              const req = http.request(options, handleResponse);
              req.setTimeout(1000, () => {
                req.abort();
              });
              req.on('error', (e) => {
                console.error(`problem with request: ${e.message}`);
                reject(new Error(`哇!连接超时啦!o(╥﹏╥)o`))
              });
              req.end();
            }, 500);
          };
          if (Array.isArray(command)) {
            command.forEach(sendRequest);
          } else {
            sendRequest(command);
          }
          return true;
        })
      }
    }
  }

  async 服务器状态(e) {
    const maxRetries = 3;
    let retries = 0;
    let disposition;
    let result = null;

    const { mode } = await getmode(e);
    if (mode === false || mode === undefined) {
      console.log(`重试请求已停止，因为GM的状态为 ${mode}。`);
      return;
    }

    while (retries < maxRetries) {
      try {
        disposition = await makeRequest();
        if (disposition) {
          result = disposition;
          break;
        }
      } catch (error) {
        console.error(`第 ${retries + 1} 次请求失败：${error.message}`);
        e.reply(`请求失败->正在重试->(${retries + 1} / ${maxRetries})`);
      }
      retries++;
      if (retries === maxRetries) {
        e.reply([segment.at(e.user_id), '在线玩家获取失败，请检查服务器设置']);
      }
    }

    if (disposition) {
      if (disposition.retcode === 0) {
        const ALL = disposition.parsed.data.online_player_num;
        const PC = disposition.parsed.data.platform_player_num.PC;
        const Android = disposition.parsed.data.platform_player_num.ANDROID;
        const IOS = disposition.parsed.data.platform_player_num.IOS;
        e.reply(`server状态：√\n在线人数：${ALL}\nPC：${PC}\nAndroid：${Android}\nIOS：${IOS}`);
      }
      else if (disposition.retcode === 1003) {
        e.reply([segment.at(e.user_id), `执行失败，服务器验证签名错误`]);
      }
      else if (retcode === 1010) {
        e.reply([segment.at(e.user_id), `\n失败 -> 服务器区服错误`]);
      }
      else {
        e.reply([segment.at(e.user_id), `\n失败 -> 请把此内容反馈给作者\n反馈内容：`, disposition]);
      }
    }
    async function makeRequest() {
      const { ip, port, region, sign, ticketping } = await getserver(e);
      const { mode } = await getmode(e);

      if (mode === true) {
        // 查询服务器状态都是符合标准的参数，不需要转义
        const parameter = { cmd: '1129', region: region, ticket: ticketping };
        const newparameter = Object.keys(parameter)
          .sort()
          .map(key => `${key}=${parameter[key]}`)
          .join('&');
        const signStr = `${newparameter}${sign}`;
        const newsign = `&sign=` + crypto.createHash('sha256').update(signStr).digest('hex');

        return new Promise((resolve, reject) => {
          const options = {
            host: ip,
            port: port,
            path: `/api?${newparameter}${newsign}`,
            method: 'GET',
            headers: {
              'Host': `${ip}:${port}`
            },
            timeout: 1000
          };
          const req = http.request(options, (res) => {
            let rawData = '';
            res.on('data', (chunk) => {
              rawData += chunk;
            });

            res.on('end', () => {
              console.log(`完整响应主体: ${rawData}`);
              const parsed = JSON.parse(rawData);
              const retcode = parsed.retcode
              const disposition = {
                parsed,
                retcode,
              }
              resolve(disposition);
            });
          });

          req.setTimeout(1000, () => {
            req.abort();
          })
          req.on('error', (e) => {
            console.error(`请求错误: ${e.message}`);
            reject(new Error(`哇！服务器连接超时啦！o(╥﹏╥)o`));
          });
          req.end();
        });
      }
    }
  }
}
