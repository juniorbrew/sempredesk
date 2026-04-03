#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import Flowable
from datetime import datetime
import os

OUTPUT = "/opt/suporte-tecnico/analise_tecnica_sempredesk.pdf"

# ─── Cores ───────────────────────────────────────────────────────────────────
AZUL         = HexColor("#1E3A5F")
AZUL_CLARO   = HexColor("#2D6A9F")
AZUL_BG      = HexColor("#EBF3FB")
VERDE        = HexColor("#1A6B3C")
VERDE_BG     = HexColor("#E6F4EE")
VERMELHO     = HexColor("#8B1A1A")
VERMELHO_BG  = HexColor("#FDEAEA")
AMARELO_BG   = HexColor("#FFF8E1")
AMARELO      = HexColor("#7B5800")
CINZA_CLARO  = HexColor("#F5F5F5")
CINZA_MEDIO  = HexColor("#CCCCCC")
CINZA_ESCURO = HexColor("#444444")
LARANJA      = HexColor("#B34700")
LARANJA_BG   = HexColor("#FFF0E6")

# ─── Estilos ─────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def make_style(name, parent="Normal", **kwargs):
    return ParagraphStyle(name, parent=styles[parent], **kwargs)

titulo_doc    = make_style("TituloDoc",    fontSize=24, textColor=white,      alignment=TA_CENTER, spaceAfter=4, fontName="Helvetica-Bold")
subtitulo_doc = make_style("SubtituloDoc", fontSize=12, textColor=HexColor("#BDD7EE"), alignment=TA_CENTER, fontName="Helvetica")
h1            = make_style("H1",           fontSize=16, textColor=AZUL,       spaceAfter=6, spaceBefore=14, fontName="Helvetica-Bold")
h2            = make_style("H2",           fontSize=13, textColor=AZUL_CLARO, spaceAfter=4, spaceBefore=10, fontName="Helvetica-Bold")
h3            = make_style("H3",           fontSize=11, textColor=CINZA_ESCURO, spaceAfter=3, spaceBefore=7, fontName="Helvetica-Bold")
body          = make_style("Body",         fontSize=9.5, textColor=CINZA_ESCURO, spaceAfter=4, leading=15, alignment=TA_JUSTIFY)
body_left     = make_style("BodyLeft",     fontSize=9.5, textColor=CINZA_ESCURO, spaceAfter=3, leading=15)
bullet        = make_style("Bullet",       fontSize=9.5, textColor=CINZA_ESCURO, spaceAfter=2, leading=14, leftIndent=14, firstLineIndent=-8)
code_style    = make_style("Code",         fontSize=8.2, textColor=HexColor("#1A1A2E"), fontName="Courier", leading=13, leftIndent=10, spaceAfter=2)
label_verde   = make_style("LabelVerde",   fontSize=9,   textColor=VERDE,     fontName="Helvetica-Bold")
label_verm    = make_style("LabelVerm",    fontSize=9,   textColor=VERMELHO,  fontName="Helvetica-Bold")
label_amar    = make_style("LabelAmar",    fontSize=9,   textColor=AMARELO,   fontName="Helvetica-Bold")
label_laranja = make_style("LabelLaranja", fontSize=9,   textColor=LARANJA,   fontName="Helvetica-Bold")
nota          = make_style("Nota",         fontSize=8.5, textColor=HexColor("#555555"), leading=13, leftIndent=10, spaceAfter=3)
toc_item      = make_style("TocItem",      fontSize=10,  textColor=AZUL_CLARO, spaceAfter=3, leftIndent=10)

# ─── Helpers de Flowable ─────────────────────────────────────────────────────

class ColorBox(Flowable):
    """Caixa colorida com texto (callout/destaque)."""
    def __init__(self, text, bg, border, text_color=None, icon="", width=None, bold=False):
        Flowable.__init__(self)
        self.text       = text
        self.bg         = bg
        self.border     = border
        self.text_color = text_color or CINZA_ESCURO
        self.icon       = icon
        self.box_width  = width or (A4[0] - 4*cm)
        self.bold       = bold
        self._build()

    def _build(self):
        fn  = "Helvetica-Bold" if self.bold else "Helvetica"
        txt = f"{self.icon} {self.text}" if self.icon else self.text
        self._para = Paragraph(txt, ParagraphStyle(
            "cb_inner", fontSize=9.5, textColor=self.text_color,
            leading=15, fontName=fn, alignment=TA_LEFT
        ))
        w, h = self._para.wrap(self.box_width - 1.2*cm, 9999)
        self.width  = self.box_width
        self.height = h + 0.6*cm

    def draw(self):
        c = self.canv
        c.saveState()
        r = 4
        c.setFillColor(self.bg)
        c.setStrokeColor(self.border)
        c.setLineWidth(0.8)
        c.roundRect(0, 0, self.width, self.height, r, fill=1, stroke=1)
        # barra lateral esquerda
        c.setFillColor(self.border)
        c.rect(0, 0, 4, self.height, fill=1, stroke=0)
        c.restoreState()
        self._para.drawOn(c, 0.7*cm, 0.3*cm)


class SectionHeader(Flowable):
    """Cabeçalho numerado de seção com fundo colorido."""
    def __init__(self, number, title, width=None):
        Flowable.__init__(self)
        self.number = number
        self.title  = title
        self.width  = width or (A4[0] - 4*cm)
        self.height = 1.0*cm

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(AZUL)
        c.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=0)
        # número em círculo
        cx, cy = 0.6*cm, self.height/2
        c.setFillColor(AZUL_CLARO)
        c.circle(cx, cy, 0.32*cm, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(cx, cy - 0.1*cm, str(self.number))
        # título
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(1.3*cm, self.height/2 - 0.2*cm, self.title)
        c.restoreState()


def sep():
    return HRFlowable(width="100%", thickness=0.5, color=CINZA_MEDIO, spaceAfter=6, spaceBefore=4)

def p(text, style=body):
    return Paragraph(text, style)

def b(text):
    return Paragraph(f"• {text}", bullet)

def h(text, level=1):
    return Paragraph(text, [h1, h2, h3][level-1])

def sp(n=6):
    return Spacer(1, n)

def code(text):
    lines = text.strip().split("\n")
    rows  = [[Paragraph(ln, code_style)] for ln in lines]
    t = Table(rows, colWidths=[A4[0] - 4*cm - 0.4*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), HexColor("#F0F0F8")),
        ("BOX",        (0,0), (-1,-1), 0.5, HexColor("#AAAACC")),
        ("TOPPADDING",    (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("LEFTPADDING",   (0,0), (-1,-1), 8),
        ("RIGHTPADDING",  (0,0), (-1,-1), 8),
    ]))
    return t

def callout(text, kind="info", icon=""):
    mapping = {
        "info":    (AZUL_BG,     AZUL_CLARO, AZUL,     "ℹ"),
        "ok":      (VERDE_BG,    VERDE,      VERDE,    "✓"),
        "warn":    (AMARELO_BG,  AMARELO,    AMARELO,  "⚠"),
        "danger":  (VERMELHO_BG, VERMELHO,   VERMELHO, "✖"),
        "action":  (LARANJA_BG,  LARANJA,    LARANJA,  "→"),
    }
    bg, border, tc, default_icon = mapping.get(kind, mapping["info"])
    return ColorBox(text, bg, border, tc, icon or default_icon, bold=(kind in ("ok","danger")))

def table_risks(data, headers):
    """Tabela de riscos colorida."""
    col_w = [(A4[0] - 4*cm) * f for f in [0.40, 0.18, 0.42]]
    header_row = [Paragraph(h, ParagraphStyle("th", fontSize=9, textColor=white, fontName="Helvetica-Bold", leading=12)) for h in headers]
    rows = [header_row]
    for row in data:
        sev = row[1].upper()
        color_map = {"CRÍTICO": VERMELHO, "ALTO": LARANJA, "MÉDIO": AMARELO, "BAIXO": VERDE}
        sev_color = color_map.get(sev, CINZA_ESCURO)
        rows.append([
            Paragraph(row[0], ParagraphStyle("td", fontSize=9, leading=13)),
            Paragraph(f"<b>{row[1]}</b>", ParagraphStyle("td_sev", fontSize=9, textColor=sev_color, fontName="Helvetica-Bold", leading=13)),
            Paragraph(row[2], ParagraphStyle("td", fontSize=9, leading=13)),
        ])
    t = Table(rows, colWidths=col_w, repeatRows=1)
    style = [
        ("BACKGROUND",    (0,0), (-1,0),  AZUL),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [white, CINZA_CLARO]),
        ("BOX",           (0,0), (-1,-1), 0.5, CINZA_MEDIO),
        ("INNERGRID",     (0,0), (-1,-1), 0.3, CINZA_MEDIO),
        ("TOPPADDING",    (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LEFTPADDING",   (0,0), (-1,-1), 7),
        ("RIGHTPADDING",  (0,0), (-1,-1), 7),
        ("VALIGN",        (0,0), (-1,-1), "TOP"),
    ]
    t.setStyle(TableStyle(style))
    return t

def table_phases(phases):
    """Tabela de plano de evolução."""
    col_w = [(A4[0] - 4*cm) * f for f in [0.22, 0.78]]
    rows = []
    for fase, items in phases:
        rows.append([
            Paragraph(f"<b>{fase}</b>", ParagraphStyle("fase", fontSize=9, textColor=white, fontName="Helvetica-Bold", leading=13, alignment=TA_CENTER)),
            Paragraph(items, ParagraphStyle("fase_items", fontSize=9, leading=13)),
        ])
    t = Table(rows, colWidths=col_w)
    colors_bg = [AZUL, AZUL_CLARO, HexColor("#3B82B6"), HexColor("#5B9BD5")]
    style = [
        ("BOX",           (0,0), (-1,-1), 0.5, CINZA_MEDIO),
        ("INNERGRID",     (0,0), (-1,-1), 0.3, CINZA_MEDIO),
        ("TOPPADDING",    (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("LEFTPADDING",   (0,0), (-1,-1), 8),
        ("RIGHTPADDING",  (0,0), (-1,-1), 8),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
    ]
    for i, _ in enumerate(phases):
        style.append(("BACKGROUND", (0,i), (0,i), colors_bg[i % len(colors_bg)]))
        style.append(("BACKGROUND", (1,i), (1,i), [white, CINZA_CLARO][i % 2]))
    t.setStyle(TableStyle(style))
    return t


# ─── Capa ─────────────────────────────────────────────────────────────────────
class CoverBlock(Flowable):
    """Bloco de capa desenhado no canvas para evitar sobreposição de linhas."""
    def __init__(self, width):
        Flowable.__init__(self)
        self.width  = width
        self.height = 5.5*cm

    def draw(self):
        c = self.canv
        c.saveState()
        # fundo
        c.setFillColor(AZUL)
        c.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=0)
        # linha decorativa superior
        c.setFillColor(AZUL_CLARO)
        c.rect(0, self.height - 0.35*cm, self.width, 0.35*cm, fill=1, stroke=0)
        # título
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 22)
        c.drawCentredString(self.width / 2, self.height - 1.5*cm, "ANÁLISE TÉCNICA DE INFRAESTRUTURA")
        # subtítulo 1
        c.setFillColor(HexColor("#BDD7EE"))
        c.setFont("Helvetica", 13)
        c.drawCentredString(self.width / 2, self.height - 2.5*cm, "SempreDesk — Portal de Atendimento")
        # linha divisória fina
        c.setStrokeColor(HexColor("#4A7DB5"))
        c.setLineWidth(0.5)
        c.line(self.width*0.2, self.height - 3.1*cm, self.width*0.8, self.height - 3.1*cm)
        # subtítulo 2
        c.setFillColor(HexColor("#BDD7EE"))
        c.setFont("Helvetica", 10)
        c.drawCentredString(self.width / 2, self.height - 3.8*cm,
                            "Prontidão para Multi-tenant, Alto Volume e Atendimento Simultâneo")
        c.restoreState()


def build_cover():
    elems = []
    elems.append(Spacer(1, 2.5*cm))
    elems.append(CoverBlock(A4[0] - 4*cm))
    elems.append(sp(30))

    # metadados
    meta = [
        ["Projeto",    "SempreDesk — suporte.sempredesk.com.br"],
        ["Stack",      "NestJS 10 · Next.js 14 · PostgreSQL 15 · Redis 7 · Socket.io · Docker Compose"],
        ["Data",       datetime.now().strftime("%d/%m/%Y")],
        ["Versão",     "1.0 — Análise Inicial de Prontidão para Escala"],
        ["Elaborado por", "Análise Automatizada via Claude Code"],
    ]
    meta_table = Table(meta, colWidths=[(A4[0]-4*cm)*0.28, (A4[0]-4*cm)*0.72])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (0,-1), CINZA_CLARO),
        ("TEXTCOLOR",   (0,0), (0,-1), AZUL),
        ("FONTNAME",    (0,0), (0,-1), "Helvetica-Bold"),
        ("FONTSIZE",    (0,0), (-1,-1), 9),
        ("TOPPADDING",  (0,0), (-1,-1), 6),
        ("BOTTOMPADDING",(0,0),(-1,-1), 6),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING",(0,0), (-1,-1), 10),
        ("GRID",        (0,0), (-1,-1), 0.3, CINZA_MEDIO),
    ]))
    elems.append(meta_table)
    elems.append(sp(30))

    # veredito
    elems.append(callout(
        "VEREDITO: O sistema NÃO está pronto para alto volume com múltiplos agentes simultâneos. "
        "A base é sólida e bem modelada, mas carrega riscos críticos que, sob carga real, gerarão "
        "inconsistência de dados, duplicidade de atribuição, falhas silenciosas e impossibilidade "
        "de escalabilidade horizontal.",
        kind="danger",
        icon="✖"
    ))
    elems.append(PageBreak())
    return elems


# ─── Sumário ──────────────────────────────────────────────────────────────────
def build_toc():
    elems = []
    elems.append(p("SUMÁRIO", h1))
    elems.append(sep())
    sections = [
        ("1.", "Multi-tenant — Isolamento e Segurança de Dados"),
        ("2.", "Concorrência e Escala"),
        ("3.", "Banco de Dados"),
        ("4.", "Infraestrutura e Serviços"),
        ("5.", "Atendimento em Tempo Real"),
        ("6.", "Resiliência"),
        ("7.", "Diagnóstico Final e Plano de Evolução"),
    ]
    for num, title in sections:
        elems.append(p(f"<b>{num}</b>  {title}", toc_item))
    elems.append(PageBreak())
    return elems


# ─── Seção 1: Multi-tenant ────────────────────────────────────────────────────
def build_s1():
    elems = []
    elems.append(SectionHeader(1, "Multi-tenant — Isolamento e Segurança de Dados"))
    elems.append(sp(8))

    elems.append(h("O que já está bom", 2))
    for txt in [
        "<b>tenant_id</b> presente em todas as tabelas e filtrado em todas as queries — isolamento lógico correto.",
        "JWT carrega <b>tenantId</b> no payload; middleware injeta em <b>req.tenantId</b> a cada request.",
        "Portal cliente multi-empresa por contato bem modelado via tabela <b>contact_customers</b> (N:N).",
        "Schemas de RBAC e permissões por tenant separados — cada tenant pode ter roles customizados.",
        "Chatbot configurável por tenant via <b>chatbot_configs</b> com UNIQUE(tenant_id).",
    ]:
        elems.append(b(txt))

    elems.append(sp(8))
    elems.append(h("Risco Crítico: Sem Row-Level Security (RLS)", 2))
    elems.append(p(
        "O isolamento é 100% feito na camada de aplicação (NestJS). Não há nenhuma proteção "
        "no nível do banco de dados. Um único bug em qualquer service — esquecer de passar "
        "<b>tenantId</b>, usar um repositório compartilhado ou uma query sem <b>WHERE</b> — "
        "expõe os dados de todos os tenants simultaneamente."
    ))
    elems.append(sp(4))
    elems.append(code(
        "-- Qualquer query sem tenantId vaza dados de TODOS os tenants:\n"
        "SELECT * FROM tickets WHERE status = 'open'; -- expõe 100% dos tenants\n\n"
        "-- Correção: habilitar RLS no PostgreSQL\n"
        "ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;\n"
        "CREATE POLICY tenant_isolation ON tickets\n"
        "  USING (tenant_id = current_setting('app.tenant_id'));"
    ))
    elems.append(sp(6))
    elems.append(callout(
        "Em ambiente SaaS com dados de múltiplas empresas, o isolamento só por app layer é inaceitável. "
        "Qualquer falha de programação é uma brecha de dados. RLS é a segunda linha de defesa obrigatória.",
        kind="danger"
    ))

    elems.append(sp(8))
    elems.append(h("Gargalo de Crescimento", 2))
    elems.append(p(
        "Todas as tabelas compartilham o mesmo schema PostgreSQL. Com crescimento linear de tenants, "
        "as tabelas <b>tickets</b>, <b>conversations</b> e <b>conversation_messages</b> vão crescer "
        "sem particionamento. Queries de um tenant grande poluem o plano de execução das queries de "
        "tenants menores (table bloat, vacuum pressure, lock contention)."
    ))
    elems.append(PageBreak())
    return elems


# ─── Seção 2: Concorrência ────────────────────────────────────────────────────
def build_s2():
    elems = []
    elems.append(SectionHeader(2, "Concorrência e Escala"))
    elems.append(sp(8))

    elems.append(h("Race Condition na Distribuição Round-Robin", 2))
    elems.append(p(
        "O ponteiro de round-robin está em <b>distribution_queues.last_assigned_user_id</b>. "
        "Se dois tickets chegarem ao mesmo tempo (WhatsApp + portal simultâneos), ambas as queries "
        "lerão o mesmo valor antes de qualquer atualização — e o mesmo agente recebe dois tickets "
        "que deveriam ir para agentes diferentes."
    ))
    elems.append(sp(4))
    elems.append(code(
        "-- As duas requisições fazem SIMULTANEAMENTE:\n"
        "SELECT last_assigned_user_id\n"
        "  FROM distribution_queues\n"
        "  WHERE department = 'suporte'; -- ambas leem o mesmo valor\n\n"
        "UPDATE distribution_queues\n"
        "  SET last_assigned_user_id = $nextAgent\n"
        "  WHERE department = 'suporte'; -- ambas gravam sem conflito\n\n"
        "-- CORREÇÃO: usar SELECT FOR UPDATE em transação\n"
        "BEGIN;\n"
        "  SELECT ... FROM distribution_queues WHERE ... FOR UPDATE;\n"
        "  UPDATE distribution_queues SET last_assigned_user_id = $next ...;\n"
        "COMMIT;"
    ))

    elems.append(sp(8))
    elems.append(h("Counters de Contrato sem Lock", 2))
    elems.append(p(
        "<b>contracts.hours_used</b> e <b>contracts.tickets_used</b> são contadores incrementados "
        "na aplicação. Em atendimentos simultâneos, dois tickets fechando ao mesmo tempo podem ler "
        "o mesmo valor e gravar o mesmo incremento — perdendo contagem."
    ))
    elems.append(sp(4))
    elems.append(code(
        "-- Dois requests simultâneos:\n"
        "-- Request A lê hours_used = 10\n"
        "-- Request B lê hours_used = 10\n"
        "-- Request A grava hours_used = 11\n"
        "-- Request B grava hours_used = 11  ← perde 1 hora!\n\n"
        "-- CORREÇÃO: update atômico\n"
        "UPDATE contracts SET hours_used = hours_used + $delta\n"
        "  WHERE id = $id RETURNING hours_used;"
    ))

    elems.append(sp(8))
    elems.append(h("Sem Lock de Ownership de Ticket", 2))
    elems.append(p(
        "Não há mecanismo que impeça dois agentes de responder ao mesmo atendimento simultaneamente. "
        "Se dois agentes abrirem o mesmo ticket e ambos enviarem mensagens no mesmo segundo, as "
        "mensagens chegam sem ordem garantida e sem conflito detectado. Em chat ao vivo via Socket.io, "
        "isso gera inconsistência visível para o cliente."
    ))

    elems.append(sp(8))
    elems.append(h("Geração de ticket_number", 2))
    elems.append(p(
        "O campo <b>ticket_number</b> é gerado na aplicação em formato #XXXXXX. Dependendo da "
        "implementação, dois tickets criados simultaneamente pelo mesmo tenant podem gerar colisão "
        "se não houver sequence atômica no banco (SEQUENCE do PostgreSQL)."
    ))

    elems.append(sp(6))
    elems.append(callout(
        "Schedulers NestJS (@Cron) executam em CADA instância do processo. Com 2 instâncias rodando, "
        "o SLA escalation dispara 2 vezes a cada 5 minutos, duplicando notificações. É necessário "
        "distributed lock via Redis antes de qualquer scheduler executar.",
        kind="warn"
    ))
    elems.append(PageBreak())
    return elems


# ─── Seção 3: Banco de Dados ──────────────────────────────────────────────────
def build_s3():
    elems = []
    elems.append(SectionHeader(3, "Banco de Dados"))
    elems.append(sp(8))

    elems.append(h("Índices Existentes — O que está correto", 2))
    idx_data = [
        ["Índice", "Avaliação"],
        ["idx_tickets_tenant_status", "✓  Bom para filtro principal de inbox"],
        ["idx_tickets_assigned",      "✓  Bom para inbox do agente"],
        ["idx_tickets_sla (partial)", "✓  Excelente — partial index evita rows desnecessários"],
        ["idx_messages_ticket",       "✓  Correto"],
        ["idx_conversations_contact", "✓  Correto"],
        ["idx_chatbot_sessions_lookup","✓  Correto para lookup de sessão"],
    ]
    col_w = [(A4[0]-4*cm)*f for f in [0.48, 0.52]]
    t = Table(idx_data, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,0), AZUL),
        ("TEXTCOLOR",     (0,0), (-1,0), white),
        ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",      (0,0), (-1,-1), 9),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [white, CINZA_CLARO]),
        ("GRID",          (0,0), (-1,-1), 0.3, CINZA_MEDIO),
        ("TOPPADDING",    (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LEFTPADDING",   (0,0), (-1,-1), 8),
        ("RIGHTPADDING",  (0,0), (-1,-1), 8),
    ]))
    elems.append(t)

    elems.append(sp(10))
    elems.append(h("Índices Ausentes — Gargalos Previsíveis", 2))
    for txt in [
        "<b>tickets(tenant_id, created_at DESC)</b> — queries de dashboard (últimos 30 dias por tenant) farão seq scan completo.",
        "<b>conversation_messages(conversation_id, created_at)</b> — crescimento de mensagens vai degradar carregamento de histórico progressivamente.",
        "<b>chatbot_sessions(last_activity)</b> partial index — limpeza de sessões expiradas fará full scan na tabela inteira.",
        "<b>devices(tenant_id, device_type)</b> — queries de summary por tipo de dispositivo sem índice.",
        "<b>ticket_messages(created_at)</b> — relatórios por período de mensagens não terão índice.",
    ]:
        elems.append(b(txt))

    elems.append(sp(8))
    elems.append(h("Connection Pooling", 2))
    elems.append(p(
        "TypeORM gerencia o pool internamente (padrão 10 conexões por instância). Sem PgBouncer, "
        "cada instância do backend abre suas próprias conexões diretas. Com múltiplas instâncias "
        "no futuro, isso resulta em centenas de conexões abertas no PostgreSQL — que tem limite "
        "padrão de 100. Sem PgBouncer, escala horizontal do backend vai derrubar o banco."
    ))

    elems.append(sp(8))
    elems.append(h("Tabelas sem Particionamento", 2))
    for txt in [
        "<b>device_metrics</b> — heartbeat a cada 2 minutos por device. Com 100 devices em 10 tenants, gera ~72.000 linhas/dia. Em 1 ano: ~26 milhões de linhas sem particionamento por data.",
        "<b>conversation_messages</b> — mensagens de WhatsApp e portal crescem sem controle. Queries com range de data vão degradar progressivamente sem partition pruning.",
        "<b>ticket_messages</b> — histórico de tickets de clientes antigos sempre carregado nas queries sem partition.",
    ]:
        elems.append(b(txt))

    elems.append(sp(6))
    elems.append(callout(
        "A modelagem de dados está boa para os primeiros 6-12 meses. O risco real começa quando "
        "device_metrics e conversation_messages ultrapassarem 5-10 milhões de linhas — ponto onde "
        "queries começam a degradar sem particionamento.",
        kind="warn"
    ))
    elems.append(PageBreak())
    return elems


# ─── Seção 4: Infraestrutura ──────────────────────────────────────────────────
def build_s4():
    elems = []
    elems.append(SectionHeader(4, "Infraestrutura e Serviços"))
    elems.append(sp(8))

    elems.append(h("Docker Compose em Produção — Single Host", 2))
    elems.append(p(
        "Docker Compose roda um único container de cada serviço em uma única máquina. Não há "
        "load balancer real entre múltiplas instâncias de backend. Consequências diretas:"
    ))
    for txt in [
        "Um pico de carga derruba o único container do backend — sem failover automático.",
        "Não é possível escalar o backend horizontalmente sem mudar a stack de deploy.",
        "O CI/CD atual faz <b>docker compose down && up</b> — há downtime a cada deploy em produção.",
        "Todos os serviços (PostgreSQL, Redis, RabbitMQ, backend, frontend) são SPOFs — Single Points of Failure.",
    ]:
        elems.append(b(txt))

    elems.append(sp(8))
    elems.append(h("RabbitMQ Instalado mas Não Usado", 2))
    elems.append(p(
        "O broker de filas está configurado no docker-compose.yml, mas <b>nenhum módulo do NestJS "
        "publica ou consome mensagens</b> via RabbitMQ. Operações críticas ainda são síncronas:"
    ))
    for txt in [
        "Envio de emails: se o SMTP falhar, o request falha e o usuário recebe erro imediato.",
        "Notificações de SLA: síncronas no ciclo do request.",
        "Webhooks outbound: sem retry automático em caso de falha do endpoint externo.",
        "Um pico de envio de emails (ex: SLA expirado para 50 tickets ao mesmo tempo) vai travar o event loop do NestJS.",
    ]:
        elems.append(b(txt))

    elems.append(sp(8))
    elems.append(h("Socket.io sem Redis Adapter — Bloqueador de Escala", 2))
    elems.append(callout(
        "Este é o principal bloqueador para qualquer escalabilidade horizontal. Socket.io, sem "
        "@socket.io/redis-adapter, só funciona em single-process. Com 2 instâncias do backend, "
        "os sockets conectados na instância A NÃO recebem eventos emitidos pela instância B. "
        "Resultado: mensagens que não chegam — o bug mais difícil de reproduzir em produção.",
        kind="danger"
    ))
    elems.append(sp(4))
    elems.append(code(
        "// CORREÇÃO — adicionar ao RealtimeGateway (2h de implementação):\n"
        "import { createAdapter } from '@socket.io/redis-adapter';\n"
        "import { createClient } from 'redis';\n\n"
        "const pubClient = createClient({ url: process.env.REDIS_URL });\n"
        "const subClient = pubClient.duplicate();\n\n"
        "await Promise.all([pubClient.connect(), subClient.connect()]);\n"
        "io.adapter(createAdapter(pubClient, subClient));"
    ))

    elems.append(sp(8))
    elems.append(h("Rate Limiting por IP — Não por Tenant", 2))
    elems.append(p(
        "ThrottlerModule está configurado com 300 req/60s por IP. Um tenant atrás de NAT "
        "corporativo (vários usuários no mesmo IP) vai atingir o limite rapidamente e bloquear "
        "todos os outros usuários da mesma rede. O rate limiting deveria ser por tenantId, "
        "não por IP."
    ))

    elems.append(sp(8))
    elems.append(h("Nginx — O que está correto", 2))
    for txt in [
        "WebSocket upgrade configurado corretamente para /socket.io/.",
        "HTTPS com Let's Encrypt + renovação semanal via cron.",
        "HSTS com 1 ano + preload — correto para produção.",
        "Headers de segurança (X-Content-Type-Options, X-Frame-Options) presentes.",
        "CORS preflight (OPTIONS 204) configurado corretamente.",
    ]:
        elems.append(b(txt))
    elems.append(PageBreak())
    return elems


# ─── Seção 5: Atendimento em Tempo Real ──────────────────────────────────────
def build_s5():
    elems = []
    elems.append(SectionHeader(5, "Atendimento em Tempo Real"))
    elems.append(sp(8))

    elems.append(h("Sem Controle de Concorrência por Ticket", 2))
    elems.append(p(
        "Não há campo <b>assigned_lock</b>, <b>editing_by</b> ou qualquer mecanismo de presença "
        "por ticket. Dois agentes podem estar no mesmo ticket simultaneamente sem saber. "
        "Não há indicador de 'agente X está respondendo agora', nem bloqueio de edição."
    ))
    elems.append(sp(4))
    elems.append(callout(
        "Cenário real: Agente A e Agente B abrem o mesmo ticket. Ambos digitam uma resposta. "
        "Ambos clicam em enviar. O cliente recebe duas respostas diferentes do suporte, "
        "possivelmente contraditórias. Não há como saber quem respondeu primeiro.",
        kind="warn"
    ))

    elems.append(sp(8))
    elems.append(h("Presença de Agentes — Implementação Correta", 2))
    elems.append(p(
        "A presença global de agentes (online/away/busy/offline) está bem implementada:"
    ))
    for txt in [
        "Heartbeat via Socket.io a cada 10 segundos — eficiente.",
        "Redis armazena presença por agente — correto para single-instance.",
        "Grace period de 60 segundos antes do clock-out automático — razoável.",
        "Emissão de <b>internal-chat:presence</b> com statusMap para todos do tenant.",
    ]:
        elems.append(b(txt))

    elems.append(sp(6))
    elems.append(callout(
        "Atenção: com 50 agentes online, o Redis recebe 5 operações/s de heartbeat. Com 200 agentes, "
        "são 20 ops/s. O Redis suporta tranquilamente, mas o broadcast de presença para todo o tenant "
        "a cada heartbeat pode gerar payloads grandes. Considere throttle no broadcast.",
        kind="info"
    ))

    elems.append(sp(8))
    elems.append(h("Grace Period de 60s — Risco em Redes Instáveis", 2))
    elems.append(p(
        "Se um agente perde conexão de internet por 61 segundos (celular, Wi-Fi oscilante), "
        "recebe clock-out automático. Em redes corporativas instáveis, isso pode gerar ciclos "
        "de clock-out/clock-in frequentes e ponto eletrônico inconsistente."
    ))

    elems.append(sp(8))
    elems.append(h("Rooms Socket.io — Organização Correta", 2))
    for txt in [
        "<b>ticket:{ticketId}</b> — sala do ticket para chat e WhatsApp.",
        "<b>conversation:{conversationId}</b> — sala da conversa.",
        "<b>tenant:{tenantId}</b> — broadcast para todo o tenant.",
        "<b>internal-chat:presence</b> — lista de agentes online.",
        "Typing indicators (<b>contact:typing</b>) implementados para WhatsApp.",
    ]:
        elems.append(b(txt))
    elems.append(PageBreak())
    return elems


# ─── Seção 6: Resiliência ─────────────────────────────────────────────────────
def build_s6():
    elems = []
    elems.append(SectionHeader(6, "Resiliência"))
    elems.append(sp(8))

    elems.append(h("Sem Idempotência em Webhooks do WhatsApp", 2))
    elems.append(p(
        "Baileys e Meta API podem reenviar o mesmo evento em caso de falha de rede ou timeout. "
        "Não há verificação de <b>external_id</b> antes de processar — a mesma mensagem pode "
        "criar dois tickets ou duas mensagens duplicadas no mesmo atendimento."
    ))
    elems.append(sp(4))
    elems.append(code(
        "// CORREÇÃO — verificar external_id antes de processar:\n"
        "async processInboundMessage(externalId: string, payload: any) {\n"
        "  const exists = await this.msgRepo.findOne({\n"
        "    where: { externalId, tenantId }\n"
        "  });\n"
        "  if (exists) return; // já processado — idempotente\n\n"
        "  // processar normalmente...\n"
        "}"
    ))

    elems.append(sp(8))
    elems.append(h("Sem Dead Letter Queue", 2))
    elems.append(p(
        "Se um processamento falhar (CNPJ não encontrado, erro de banco, timeout de SMTP), "
        "o chatbot pode travar em um step sem recuperação automática. Não há retry com backoff "
        "exponencial nem Dead Letter Queue para eventos com falha reiterada."
    ))

    elems.append(sp(8))
    elems.append(h("Webhooks Outbound sem Retry", 2))
    elems.append(p(
        "O módulo de webhooks externos não tem evidência de retry automático. Se o endpoint "
        "do cliente retornar erro 500 ou timeout, o evento é perdido silenciosamente."
    ))

    elems.append(sp(8))
    elems.append(h("Backup Automatizado", 2))
    elems.append(callout(
        "Não há evidência de backup automatizado do volume postgres_data. Em falha do host "
        "(disco corrompido, falha de hardware, erro humano com rm -rf), todos os dados de "
        "todos os tenants são perdidos permanentemente. Este é o risco operacional mais crítico do momento.",
        kind="danger"
    ))
    elems.append(sp(4))
    elems.append(code(
        "# Exemplo de backup diário com pg_dump:\n"
        "#!/bin/bash\n"
        "DATE=$(date +%Y%m%d_%H%M)\n"
        "docker exec postgres pg_dump -U suporte suporte_tecnico \\\n"
        "  | gzip > /backups/suporte_$DATE.sql.gz\n\n"
        "# Enviar para S3:\n"
        "aws s3 cp /backups/suporte_$DATE.sql.gz s3://seu-bucket/backups/"
    ))

    elems.append(sp(8))
    elems.append(h("O que está bem na resiliência", 2))
    for txt in [
        "Redis com <b>appendonly: yes</b> (AOF) — persistência de dados de cache.",
        "RabbitMQ configurado e pronto — só precisa ser usado.",
        "Health check nos containers Docker (<b>/api/v1/health</b>) — permite detecção de falha.",
        "JWT com refresh token (30 dias) — sessões resilientes a curtos períodos offline.",
        "Retry strategy no cliente Redis (<b>Math.min(times * 200, 2000)</b>) — reconexão automática.",
        "Prometheus + Grafana para observabilidade — excelente sinal de maturidade operacional.",
    ]:
        elems.append(b(txt))
    elems.append(PageBreak())
    return elems


# ─── Seção 7: Diagnóstico Final ───────────────────────────────────────────────
def build_s7():
    elems = []
    elems.append(SectionHeader(7, "Diagnóstico Final e Plano de Evolução"))
    elems.append(sp(8))

    # tabela de riscos
    elems.append(h("Tabela de Riscos", 2))
    risks = [
        ["Sem RLS no PostgreSQL",               "CRÍTICO", "Vazamento de dados entre tenants em qualquer bug de código"],
        ["Sem backup automatizado",             "CRÍTICO", "Perda total de dados em falha de disco ou erro humano"],
        ["Socket.io sem Redis Adapter",         "CRÍTICO", "Mensagens perdidas ao rodar mais de uma instância do backend"],
        ["Race condition no round-robin",       "ALTO",    "Mesmo agente recebe dois tickets que deveriam ir para agentes diferentes"],
        ["Schedulers sem distributed lock",     "ALTO",    "Duplicação de SLA escalation e alertas com múltiplas instâncias"],
        ["RabbitMQ não usado (emails síncronos)","ALTO",   "Pico de notificações trava o event loop do NestJS"],
        ["Counters sem lock (contratos)",       "MÉDIO",   "Contagem incorreta de horas/tickets usados em uso simultâneo"],
        ["Sem idempotência em webhooks WA",     "MÉDIO",   "Tickets e mensagens duplicados em reenvio do webhook"],
        ["Sem lock de ownership de ticket",     "MÉDIO",   "Dois agentes respondem o mesmo atendimento simultaneamente"],
        ["Sem PgBouncer",                       "MÉDIO",   "Explosão de conexões PostgreSQL ao escalar o backend"],
        ["Rate limiting por IP (não tenant)",   "BAIXO",   "NAT corporativo bloqueia múltiplos usuários do mesmo tenant"],
        ["Tabelas sem particionamento",         "BAIXO",   "Degradação progressiva de queries em 12-18 meses"],
    ]
    elems.append(table_risks(risks, ["Risco", "Severidade", "Impacto"]))

    elems.append(sp(12))
    elems.append(h("O que já está bom", 2))
    goods = [
        "Modelagem de banco robusta — 30+ tabelas bem relacionadas, tipos corretos, ENUMs, índices básicos.",
        "Isolamento lógico de tenant_id consistente em toda a aplicação.",
        "Arquitetura modular NestJS — fácil de extrair em microserviços no futuro.",
        "Presença em tempo real (Redis + heartbeat 10s) bem implementada.",
        "Chatbot stateful por sessão com suporte a CNPJ, avaliação e templates customizáveis.",
        "Stack moderna: NestJS 10, Next.js 14, PostgreSQL 15, Redis 7, Socket.io.",
        "HTTPS, HSTS, headers de segurança no Nginx — produção-ready.",
        "Prometheus + Grafana + exporters — observabilidade de boa maturidade.",
        "RBAC com permissions matrix por tenant — flexível e correto.",
        "Integração dupla WhatsApp (Baileys + Meta API) — redundância de provedor.",
        "JWT com access (8h) + refresh (30d) e interceptor de renovação automática no frontend.",
    ]
    for g in goods:
        elems.append(b(g))

    elems.append(sp(12))
    elems.append(h("Plano Prático de Evolução (Priorizado)", 2))

    phases = [
        ("FASE 1\nSegurança\n(imediato)", (
            "<b>1. Ativar RLS no PostgreSQL</b> — habilitar em todas as tabelas, criar policies por tenant_id.<br/>"
            "<b>2. Backup diário automatizado</b> — pg_dump + upload S3 com retenção de 30 dias.<br/>"
            "<b>3. Idempotência em webhooks WhatsApp</b> — verificar external_id antes de processar.<br/>"
            "<b>4. Corrigir counters de contratos</b> — trocar por UPDATE atômico (hours_used = hours_used + delta)."
        )),
        ("FASE 2\nConcorrência\n(antes de múltiplos agentes)", (
            "<b>5. Redis Adapter no Socket.io</b> — 2h de implementação, zero impacto funcional.<br/>"
            "<b>6. Distributed lock para schedulers</b> — Redis SET NX antes de cada @Cron executar.<br/>"
            "<b>7. SELECT FOR UPDATE no round-robin</b> — eliminar race condition de atribuição.<br/>"
            "<b>8. Usar RabbitMQ para emails e notificações</b> — publicar evento, consumir assíncrono.<br/>"
            "<b>9. Lock de ownership de ticket</b> — campo editing_by_user_id + broadcast via Socket.io."
        )),
        ("FASE 3\nEscala\n(ao crescer)", (
            "<b>10. PgBouncer</b> — proxy de connection pooling na frente do PostgreSQL.<br/>"
            "<b>11. Índices adicionais</b> — tickets(tenant_id, created_at), conversation_messages(conversation_id).<br/>"
            "<b>12. Rate limiting por tenantId</b> — Redis counter por tenant, não por IP.<br/>"
            "<b>13. Cache de dashboard</b> — TTL 60s no Redis para stats de dashboard."
        )),
        ("FASE 4\nMaturidade\n(longo prazo)", (
            "<b>14. Particionamento de device_metrics e conversation_messages</b> — por range de data.<br/>"
            "<b>15. Migrar deploy para Docker Swarm ou Kubernetes</b> — zero downtime, horizontal scaling.<br/>"
            "<b>16. Dead Letter Queue para chatbot</b> — retry com backoff exponencial.<br/>"
            "<b>17. pg_stat_statements + slow query log</b> — monitorar queries > 100ms no Grafana."
        )),
    ]
    elems.append(table_phases(phases))

    elems.append(sp(12))
    elems.append(callout(
        "CONCLUSÃO: A base está bem pensada, mas ainda é um sistema single-node sem as proteções "
        "de concorrência necessárias para operar com múltiplos agentes em produção real. "
        "Corrija os 9 pontos das Fases 1 e 2 antes de colocar clientes pagantes. "
        "As Fases 3 e 4 são para quando o crescimento exigir escala horizontal.",
        kind="action",
        icon="→"
    ))
    return elems


# ─── Rodapé e Cabeçalho de Página ────────────────────────────────────────────
def on_page(canvas, doc):
    canvas.saveState()
    w, h_page = A4
    # rodapé
    canvas.setStrokeColor(CINZA_MEDIO)
    canvas.setLineWidth(0.5)
    canvas.line(2*cm, 1.5*cm, w - 2*cm, 1.5*cm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(HexColor("#888888"))
    canvas.drawString(2*cm, 1.1*cm, "SempreDesk — Análise Técnica de Infraestrutura")
    canvas.drawRightString(w - 2*cm, 1.1*cm, f"Página {doc.page}")
    canvas.restoreState()


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=A4,
        leftMargin=2*cm,
        rightMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2.5*cm,
        title="Análise Técnica — SempreDesk",
        author="Claude Code",
        subject="Prontidão para Multi-tenant e Alto Volume",
    )

    story = []
    story += build_cover()
    story += build_toc()
    story += build_s1()
    story += build_s2()
    story += build_s3()
    story += build_s4()
    story += build_s5()
    story += build_s6()
    story += build_s7()

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF gerado: {OUTPUT}")

if __name__ == "__main__":
    main()
