// Authoritative EN / ZH-CN UI & error copy for Remote Cast (exported as keyed objects for i18n parity & guard checks).
export const I18N_KEYS: readonly string[] = (
  "nf|rt|cm|os|oss|cn|ht|s1|s2|s3|tb|nt|ct|pa|rs|dc|dcl|rv3|rvl|sbb|rsb|rsg|sbn|tsb|tsbi|rn|bk|fw|rl|up|ql|lv|ch|mc|sc|" +
  "q_auto|q_ultra|q_low|q_medium|q_high|qt_auto|qt_ultra|qt_low|qt_medium|qt_high|" +
  "fs|ps|rv|nc|kb|lv2|nt0|nt0b|wc|wcb|ld|pp|ip|tp|ti|se|bs|un|cp|ps2|sa|su|sd|pd|id|" +
  "ok|ca|rp|da|df|dp|dl|ts|td|tpa|trs|trf|tcl|tsw|tsc|tnt|tcp|tps|trc|ttc|tdc|trl|" +
  "st|dm|dt|rmy|rse|ap|qu|sb|ut|lg|la|dq|dc2|bg|ip2|of|k5|k12|k15|k30|k60|bgp|" +
  "sf|sv|svd|svf|sfb|ed|ep|" +
  "e_not_detected|e_port_busy|e_launch_failed|e_chrome_missing|e_allow_timeout|e_allow_denied|" +
  "e_conn_lost|e_timeout|e_tab_changed|e_tab_close_failed|e_relay_busy|e_relay_down|e_unconfirmed|" +
  "b_closed|b_timeout|b_init|b_notools|b_busy|b_generic"
).split("|");

const EN: readonly string[] = (
  "Chrome not found|Retry|Connect my Chrome|Open separate Chrome|No permission prompt. Uses a clean profile.|Connecting…|How to connect|Open Chrome.|In Chrome, open $0 and turn on remote debugging.|Click *Connect my Chrome*, then Allow in Chrome. Or open a separate Chrome — no prompt.|Tabs|New tab|Close tab|Pause|Resume|Standby|Standby (keeps Chrome Allow)|Revoke|Revoke Grant|Standby · Grant Kept|Resume Stream|Resuming…|0 FPS standby — Chrome stays authorized. Resume anytime without re-allowing.|Standby · Grant kept|Entering standby…|Standby keeps Chrome Allow alive at 0 FPS. Use Revoke to drop it.|Back|Forward|Reload|URL or search|Quality|Level|Chrome|My Chrome|Separate Chrome|" +
  "Auto|Saver|Low|Balanced|High|Adjusts to your network.|For very slow networks: lower quality, fewer frames.|For weak networks.|Good quality, smooth.|Sharpest. Needs a fast network.|" +
  "Frame size|Page size|Refresh view|No change|Keyboard|Live view|No open tabs|Chrome is still connected.|Chrome window closed|Open a new tab to keep going, or enter standby.|Loading…|Paused · Click to resume|Paused while idle · Click to resume|Type or paste…|Type in|Send ↵|Delete|Undo|Copy|Paste|Select all|Scroll up|Scroll down|Paused|Paused while idle|" +
  "OK|Cancel|Reply…|Alert|Confirm|Input|Leave this page?|✓ Sent|Disconnected|✓ Paused|✓ Resumed|↻ Refreshed|✓ Closed|Switching…|✓ Switched|↗ New tab|✓ Copied|✓ Pasted|Right-click|Switched tab|Disconnecting…|Settings file changed — reloaded.|" +
  "Settings|Dismiss|Details|Chrome ready|Separate Chrome ready|Auto · | · {n} queued|Separate|Untitled|Language|Follow system|Default quality|Connect to|Background refresh|Idle pause|Off|5s|12s|15s|30s|60s|Paused (bg)|" +
  "Settings file|Saving…|✓ Saved|Couldn't save|settings.json has an error. Using your last good settings.|Couldn't disconnect. Try again.|Couldn't pause. Try again.|" +
  "Chrome's remote debugging is off. Open chrome://inspect/#remote-debugging and turn it on, or open a separate Chrome.|Couldn't find a free port for separate Chrome. Try again, or connect your own Chrome.|Couldn't open separate Chrome. Try again.|Couldn't find Chrome on this Mac.|Chrome didn't answer. If it asked for permission, click Allow and try again.|Chrome declined the connection. Click Allow when it asks.|" +
  "Lost connection to Chrome.|Chrome is taking too long. Try again.|The tab changed. Try again.|Couldn't close the tab.|Remote Cast is busy. Try again in a moment.|Remote Cast's background service isn't running. Reopen the panel.|No confirmation from Chrome. Check the status and try again.|" +
  "Lost connection to Antigravity.|Antigravity didn't respond. Try again.|Couldn't start the panel. Reopen it.|This panel can't run actions here.|Connection is busy. Try again in a moment.|Something went wrong. Try again."
).split("|");

const ZH: readonly string[] = (
  "未发现 Chrome|重试|连接本机 Chrome|打开独立 Chrome|无需授权，使用全新配置。|正在连接…|连接说明|打开 Chrome。|在 Chrome 中打开 $0 并开启远程调试。|点击 *连接本机 Chrome*，并在 Chrome 弹窗中点「允许」；也可打开独立 Chrome，无需授权。|标签页|新建标签页|关闭标签页|暂停|继续|待机|待机（保留 Chrome 授权）|撤销|撤销授权|待机中 · 已保留授权|恢复画面|正在恢复…|0 FPS 待机中，Chrome 授权保持有效，随时点击即可直接恢复。|已待机 · 保留授权|正在待机…|待机将在 0 FPS 下保留 Chrome 授权；点击「撤销」才会彻底断开连接。|后退|前进|刷新|输入网址或搜索|画质|档位|连接方式|本机 Chrome|独立 Chrome|" +
  "自动|省流|流畅|均衡|高清|跟随网速调整。|极弱网适用：更低画质与帧率。|弱网环境适用。|兼顾画质与流畅度。|最高画质，需较佳网络。|" +
  "画面大小|页面尺寸|刷新画面|画面无变化|键盘|实时画面|暂无打开的标签页|Chrome 仍保持连接。|Chrome 窗口已关闭|新建标签页继续，或进入待机。|正在加载…|已暂停 · 点击继续|闲置已暂停 · 点击继续|输入或粘贴…|输入|发送 ↵|退格|撤销|复制|粘贴|全选|向上滚动|向下滚动|已暂停|闲置暂停|" +
  "确定|取消|输入回复…|提示|确认|输入|离开此页？|✓ 已发送|已断开|✓ 已暂停|✓ 已继续|↻ 已刷新|✓ 已关闭|正在切换…|✓ 已切换|↗ 已新建标签页|✓ 已复制|✓ 已粘贴|右键|已切换标签页|正在断开…|配置文件已变更，已自动重载。|" +
  "设置|关闭|详情|Chrome 已就绪|独立 Chrome 已就绪|自动 · | · 待发送 {n}|独立|无标题|语言|跟随系统|默认画质|默认连接|后台刷新|闲置暂停|关|5 秒|12 秒|15 秒|30 秒|60 秒|暂停|" +
  "配置文件|正在保存…|✓ 已保存|保存失败|配置文件有误，暂时沿用上次的有效设置。|断开失败，请重试。|暂停失败，请重试。|" +
  "Chrome 尚未开启远程调试。请打开 chrome://inspect/#remote-debugging 开启，或改用独立 Chrome。|独立 Chrome 暂无可用端口。请重试，或改为连接本机 Chrome。|独立 Chrome 启动失败，请重试。|未在这台 Mac 上找到 Chrome。|Chrome 没有响应。如果弹出了授权窗口，请点「允许」后重试。|Chrome 拒绝了连接。弹出授权窗口时请点「允许」。|" +
  "与 Chrome 的连接已断开。|Chrome 响应超时，请重试。|目标标签页已变更，请重试。|关闭标签页失败。|Remote Cast 正忙，请稍后再试。|Remote Cast 后台服务未运行，请重新打开面板。|没有收到 Chrome 的确认，请查看状态后重试。|" +
  "与 Antigravity 的连接已断开。|Antigravity 没有响应，请重试。|面板启动失败，请重新打开。|当前环境不支持面板操作。|当前请求繁忙，请稍后再试。|操作失败，请重试。"
).split("|");

export type I18nDict = Record<string, string>;

const zip = (vals: readonly string[]): I18nDict => {
  const o: I18nDict = {};
  for (let i = 0; i < I18N_KEYS.length; i++) o[I18N_KEYS[i]] = vals[i];
  return o;
};

export const I18N: { readonly en: I18nDict; readonly "zh-CN": I18nDict } = {
  en: zip(EN),
  "zh-CN": zip(ZH),
};
