import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ChatbotService } from './chatbot.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { UpdateChatbotConfigDto, UpdateMenuDto, WidgetStartDto, WidgetMessageDto } from './dto/chatbot.dto';

@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(private readonly chatbotService: ChatbotService) {}

  // ─── Admin endpoints (require auth) ─────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('config')
  getConfig(@TenantId() tenantId: string) {
    return this.chatbotService.getOrCreateConfig(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('config')
  updateConfig(@TenantId() tenantId: string, @Body() dto: UpdateChatbotConfigDto) {
    return this.chatbotService.updateConfig(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Put('menu')
  updateMenu(@TenantId() tenantId: string, @Body() dto: UpdateMenuDto) {
    return this.chatbotService.updateMenu(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats')
  getStats(@TenantId() tenantId: string) {
    return this.chatbotService.getStats(tenantId);
  }

  // ─── Web Widget endpoints (public) ──────────────────────────────────────────

  /** Returns bot config for the widget (public) */
  @Get('widget/:tenantId/config')
  widgetConfig(@Param('tenantId') tenantId: string) {
    return this.chatbotService.getWidgetConfig(tenantId);
  }

  /** Start a new widget session */
  @Post('widget/:tenantId/start')
  @HttpCode(HttpStatus.OK)
  widgetStart(@Param('tenantId') tenantId: string, @Body() dto: WidgetStartDto) {
    return this.chatbotService.widgetStart(tenantId, dto);
  }

  /** Send message in widget session */
  @Post('widget/:tenantId/message')
  @HttpCode(HttpStatus.OK)
  widgetMessage(
    @Param('tenantId') tenantId: string,
    @Body() dto: WidgetMessageDto,
  ) {
    return this.chatbotService.widgetMessage(tenantId, dto.sessionId, dto.text);
  }

  /** Poll for new messages (long-polling fallback) */
  @Get('widget/:tenantId/poll')
  widgetPoll(
    @Param('tenantId') tenantId: string,
    @Query('sessionId') sessionId: string,
    @Query('since') since: string,
  ) {
    return this.chatbotService.widgetPoll(tenantId, sessionId, since);
  }

  /** Serve the embeddable widget JS */
  @Get('widget.js')
  @HttpCode(HttpStatus.OK)
  widgetJs(@Query('tenantId') tenantId: string, @Res() res: Response) {
    const apiBase = process.env.API_BASE_URL || '';
    const js = generateWidgetJs(tenantId, apiBase);
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(js);
  }
}

/** Inline widget JS generator — no file system dependency */
function generateWidgetJs(tenantId: string, apiBase: string): string {
  return `
(function() {
  'use strict';
  var TENANT = '${tenantId}';
  var API = '${apiBase}/api/v1/chatbot/widget/' + TENANT;
  var sessionId = null;
  var lastMsgTime = null;
  var pollInterval = null;

  var styles = \`
    #sd-chat-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#4F46E5,#6366F1);box-shadow:0 4px 16px rgba(79,70,229,.45);cursor:pointer;border:none;display:flex;align-items:center;justify-content:center;z-index:99998;transition:transform .2s}
    #sd-chat-btn:hover{transform:scale(1.1)}
    #sd-chat-btn svg{width:26px;height:26px;fill:#fff}
    #sd-chat-box{position:fixed;bottom:90px;right:24px;width:360px;max-height:520px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);display:none;flex-direction:column;z-index:99999;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    #sd-chat-header{background:linear-gradient(135deg,#4F46E5,#6366F1);padding:14px 16px;display:flex;align-items:center;gap:10px}
    #sd-chat-header-avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:18px}
    #sd-chat-header-info{flex:1}
    #sd-chat-header-name{color:#fff;font-weight:700;font-size:14px}
    #sd-chat-header-status{color:rgba(255,255,255,.8);font-size:11px}
    #sd-chat-close{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;padding:0;opacity:.8}
    #sd-chat-close:hover{opacity:1}
    #sd-chat-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:280px;max-height:380px;background:#F8FAFC}
    .sd-msg{max-width:82%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.5;word-break:break-word}
    .sd-msg-bot{align-self:flex-start;background:#fff;border:1px solid #E2E8F0;color:#1E293B;border-bottom-left-radius:4px}
    .sd-msg-user{align-self:flex-end;background:linear-gradient(135deg,#4F46E5,#6366F1);color:#fff;border-bottom-right-radius:4px}
    .sd-msg-agent{align-self:flex-start;background:#ECFDF5;border:1px solid #BBF7D0;color:#065F46;border-bottom-left-radius:4px}
    .sd-typing{align-self:flex-start;padding:10px 14px;background:#fff;border:1px solid #E2E8F0;border-radius:14px;border-bottom-left-radius:4px}
    .sd-typing span{display:inline-block;width:6px;height:6px;background:#94A3B8;border-radius:50%;animation:sd-bounce .8s infinite;margin:0 2px}
    .sd-typing span:nth-child(2){animation-delay:.15s}
    .sd-typing span:nth-child(3){animation-delay:.3s}
    @keyframes sd-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
    #sd-chat-input-area{padding:10px 12px;border-top:1px solid #F1F5F9;display:flex;gap:8px;background:#fff}
    #sd-chat-input{flex:1;border:1.5px solid #E2E8F0;border-radius:10px;padding:9px 12px;font-size:13px;outline:none;resize:none;font-family:inherit;max-height:80px}
    #sd-chat-input:focus{border-color:#6366F1}
    #sd-chat-send{background:linear-gradient(135deg,#4F46E5,#6366F1);border:none;border-radius:10px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}
    #sd-chat-send:hover{opacity:.9}
    #sd-chat-send svg{width:16px;height:16px;fill:#fff}
  \`;

  function injectStyles() {
    if (document.getElementById('sd-styles')) return;
    var s = document.createElement('style');
    s.id = 'sd-styles';
    s.textContent = styles;
    document.head.appendChild(s);
  }

  function createWidget() {
    injectStyles();

    var btn = document.createElement('button');
    btn.id = 'sd-chat-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>';
    btn.onclick = toggleChat;
    document.body.appendChild(btn);

    var box = document.createElement('div');
    box.id = 'sd-chat-box';
    box.innerHTML = \`
      <div id="sd-chat-header">
        <div id="sd-chat-header-avatar">🤖</div>
        <div id="sd-chat-header-info">
          <div id="sd-chat-header-name">Assistente Virtual</div>
          <div id="sd-chat-header-status">● Online</div>
        </div>
        <button id="sd-chat-close" onclick="document.getElementById('sd-chat-box').style.display='none'">×</button>
      </div>
      <div id="sd-chat-messages"></div>
      <div id="sd-chat-input-area">
        <textarea id="sd-chat-input" placeholder="Digite sua mensagem..." rows="1"></textarea>
        <button id="sd-chat-send" onclick="sdSend()">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    \`;
    document.body.appendChild(box);

    document.getElementById('sd-chat-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sdSend(); }
    });
  }

  function toggleChat() {
    var box = document.getElementById('sd-chat-box');
    var isOpen = box.style.display === 'flex';
    box.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen && !sessionId) startSession();
    if (!isOpen) scrollBottom();
  }

  function startSession() {
    fetch(API + '/start', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ pageUrl: window.location.href }),
    })
    .then(r => r.json())
    .then(data => {
      sessionId = data.sessionId;
      lastMsgTime = null;
      renderMessages(data.messages);
      startPolling();
    })
    .catch(function(e) { console.error('[SempreDesk]', e); });
  }

  window.sdSend = function() {
    if (!sessionId) return;
    var input = document.getElementById('sd-chat-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendMessage('user', text);
    showTyping();
    fetch(API + '/message', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: sessionId, text: text }),
    })
    .then(r => r.json())
    .then(data => {
      hideTyping();
      renderMessages(data.messages);
    })
    .catch(function(e) { hideTyping(); console.error('[SempreDesk]', e); });
  };

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(function() {
      if (!sessionId) return;
      var since = lastMsgTime ? lastMsgTime : '';
      fetch(API + '/poll?sessionId=' + sessionId + '&since=' + encodeURIComponent(since))
        .then(r => r.json())
        .then(function(msgs) {
          if (msgs && msgs.length) renderMessages(msgs);
        })
        .catch(function() {});
    }, 3000);
  }

  function renderMessages(msgs) {
    if (!msgs || !msgs.length) return;
    msgs.forEach(function(m) {
      if (lastMsgTime && new Date(m.createdAt) <= new Date(lastMsgTime)) return;
      appendMessage(m.role, m.content);
      lastMsgTime = m.createdAt;
    });
    scrollBottom();
  }

  function appendMessage(role, text) {
    var container = document.getElementById('sd-chat-messages');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'sd-msg sd-msg-' + role;
    div.textContent = text;
    container.appendChild(div);
    scrollBottom();
  }

  var typingEl = null;
  function showTyping() {
    if (typingEl) return;
    var container = document.getElementById('sd-chat-messages');
    typingEl = document.createElement('div');
    typingEl.className = 'sd-typing';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(typingEl);
    scrollBottom();
  }
  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function scrollBottom() {
    var el = document.getElementById('sd-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
`;
}
