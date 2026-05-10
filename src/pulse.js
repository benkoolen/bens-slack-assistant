// Slack Pulse Check — src/pulse.js
// Fetches channel history, analyses with Claude, sends report as a Slack DM

import Anthropic from "@anthropic-ai/sdk";

// ─── Config (all from environment / GitHub Secrets) ───────────────────────────

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Your Slack member ID — find it in Slack: click your avatar → Profile → ⋮ menu → Copy member ID
// Looks like U012AB3CD
const SLACK_REPORT_USER_ID = process.env.SLACK_REPORT_USER_ID;

// Space/comma-separated channel names or IDs e.g. "general client-abridge spenn-internal"
const CHANNELS = (process.env.SLACK_CHANNELS || "general")
  .split(/[\s,]+/)
  .map((c) => c.trim().replace(/^#/, ""))
  .filter(Boolean);

const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "7");
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES || "100");

// Options: agency | product | startup | sales
const FOCUS_LENS = process.env.FOCUS_LENS || "agency";

const FOCUS_CONTEXT = {
  agency:
    "This is a client services / CRM agency team. Flag: client concerns, project blockers, team friction, scope creep, upsell opportunities, client relationship risks, delivery confidence signals.",
  product:
    "This is a product team. Flag: bugs, feature debates, sprint blockers, engineering debt, stakeholder tension, launch readiness.",
  startup:
    "This is an all-hands startup. Flag: morale signals, strategy drift, hiring concerns, revenue/growth signals, team alignment.",
  sales:
    "This is a sales and BD team. Flag: deal risks, objection patterns, competitor mentions, pipeline health, new opportunity signals.",
};

// ─── Slack helpers ─────────────────────────────────────────────────────────────

async function slackGet(path, params = {}) {
  const url = new URL(`https://slack.com/api/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error (${path}): ${data.error}`);
  return data;
}

async function slackPost(path, body) {
  const res = await fetch(`https://slack.com/api/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error (${path}): ${data.error}`);
  return data;
}

async function resolveChannelId(nameOrId) {
  if (/^C[A-Z0-9]+$/.test(nameOrId)) return nameOrId;

  let cursor;
  do {
    const params = { limit: 200, exclude_archived: true };
    if (cursor) params.cursor = cursor;
    const data = await slackGet("conversations.list", params);
    const found = data.channels.find((c) => c.name === nameOrId);
    if (found) return found.id;
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);

  throw new Error(
    `Channel "${nameOrId}" not found — check spelling or invite the bot.`
  );
}

async function fetchMessages(channelNameOrId) {
  const channelId = await resolveChannelId(channelNameOrId);
  const oldest = Math.floor(
    (Date.now() - LOOKBACK_DAYS * 86_400_000) / 1000
  ).toString();

  const data = await slackGet("conversations.history", {
    channel: channelId,
    oldest,
    limit: MAX_MESSAGES,
  });

  const messages = (data.messages || [])
    .filter((m) => m.type === "message" && m.text && !m.bot_id && !m.subtype)
    .reverse();

  return { channelName: channelNameOrId, channelId, messages };
}

// ─── Claude analysis ───────────────────────────────────────────────────────────

async function analyse(channelData) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const transcript = channelData
    .map(({ channelName, messages }) => {
      const lines = messages
        .slice(0, 80)
        .map((m) => {
          const date = new Date(parseFloat(m.ts) * 1000).toLocaleDateString(
            "en-GB",
            { day: "numeric", month: "short" }
          );
          return `[${date}] ${m.text.replace(/\n+/g, " ").slice(0, 300)}`;
        })
        .join("\n");
      return `=== #${channelName} (${messages.length} messages) ===\n${lines || "(no messages this period)"}`;
    })
    .join("\n\n");

  const CLIENT_GROUPS = {
    "sleep-cycle": ["sleep-cycle-schmack", "sleep-cycle-schmack-tech", "sleep-cycle-internal"],
    "spenn":       ["spenn-schmack", "spenn-schmack-crm", "spenn-internal"],
    "abridge":     ["abridge-internal"],
    "bruce":       ["bruce-internal"],
    "readly":      ["readly-internal"],
    "vmo2":        ["vmo2-internal-bau", "vmo2-internal-all", "vmo2-internal-transformation"],
    "vr":          ["vr-internal"],
  };

  const clientMap = Object.entries(CLIENT_GROUPS)
    .map(([client, chs]) => `- ${client}: ${chs.map(c => `#${c}`).join(", ")}`)
    .join("\n");

  const prompt = `You are an expert organisational analyst embedded in the leadership team of SCHMACK, a CRM and lifecycle marketing agency.
You have been given a ${LOOKBACK_DAYS}-day Slack transcript across ${channelData.length} channels, grouped by client account.

Channel to client mapping:
${clientMap}

Channels ending in "-schmack" or "-crm" are shared with the client. Channels ending in "-internal" are internal SCHMACK team discussions about that client.

Context: ${FOCUS_CONTEXT[FOCUS_LENS] || FOCUS_CONTEXT.agency}

Produce a structured pulse check report grouped by client. Return ONLY valid JSON — no markdown, no preamble, no trailing text.

JSON schema:
{
  "summary": "2-3 sentence executive summary across all clients this period",
  "overall_health": "green|amber|red",
  "health_rationale": "one sentence explaining the overall rating",
  "client_snapshots": [
    { "client": "client-name", "health": "green|amber|red", "tone": "positive|neutral|tense|quiet", "key_theme": "one short phrase" }
  ],
  "concerns": [
    { "title": "short title", "detail": "1-2 sentences", "severity": "high|medium|low", "client": "client-name", "channel": "#channel-name" }
  ],
  "opportunities": [
    { "title": "short title", "detail": "1-2 sentences", "type": "upsell|process|relationship|strategy", "client": "client-name", "channel": "#channel-name" }
  ],
  "nip_in_bud": [
    { "title": "short title", "action": "specific recommended action", "urgency": "this week|this month", "client": "client-name" }
  ],
  "positive_signals": ["signal 1", "signal 2"]
}

If a category is empty, return an empty array. Be specific and actionable — name the client and the concrete issue, not generic observations.

TRANSCRIPT:
${transcript.slice(0, 20_000)}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content
    .map((b) => b.text || "")
    .join("")
    .replace(/```json|```/g, "")
    .trim();
  return JSON.parse(raw);
}

// ─── Slack Block Kit renderer ──────────────────────────────────────────────────

function buildBlocks(report, channelNames, runDate) {
  const healthEmoji = { green: "🟢", amber: "🟡", red: "🔴" };
  const healthLabel = { green: "All clear", amber: "Needs attention", red: "At risk" };
  const severityEmoji = { high: "🔴", medium: "🟡", low: "🔵" };
  const urgencyEmoji = { "this week": "🔴", "this month": "🟡" };
  const typeEmoji = { upsell: "💰", process: "⚙️", relationship: "🤝", strategy: "🎯" };
  const toneEmoji = { positive: "😊", neutral: "😐", tense: "😬", quiet: "🔇" };

  const blocks = [];

  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `${healthEmoji[report.overall_health] || "⚪"} Weekly Pulse Check — ${healthLabel[report.overall_health] || report.overall_health}`,
    },
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${runDate}  ·  Last ${LOOKBACK_DAYS} days  ·  ${channelNames.length} channels  ·  ${FOCUS_LENS} lens`,
      },
    ],
  });

  blocks.push({ type: "divider" });

  // Summary
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Summary*\n${report.summary}\n_${report.health_rationale}_`,
    },
  });

  // Client snapshots
  if (report.client_snapshots?.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*💬 Client snapshots*" },
    });
    const snapshotLines = report.client_snapshots
      .map((s) => {
        const h = { green: "🟢", amber: "🟡", red: "🔴" }[s.health] || "⚪";
        return `${h} ${toneEmoji[s.tone] || "•"} *${s.client}* — ${s.key_theme}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: snapshotLines },
    });
  }

  // Concerns
  if (report.concerns?.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*⚠️ Concerns*" },
    });
    report.concerns.forEach((c) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${severityEmoji[c.severity] || "•"} *${c.title}* \`${c.severity}\` \`${c.client || ""}\` \`${c.channel}\`\n${c.detail}`,
        },
      });
    });
  }

  // Nip in the bud
  if (report.nip_in_bud?.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*✂️ Nip in the bud*" },
    });
    report.nip_in_bud.forEach((n) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${urgencyEmoji[n.urgency] || "•"} *${n.title}* \`${n.urgency}\`${n.client ? ` \`${n.client}\`` : ""}\n*Action:* ${n.action}`,
        },
      });
    });
  }

  // Opportunities
  if (report.opportunities?.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*✨ Opportunities*" },
    });
    report.opportunities.forEach((o) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${typeEmoji[o.type] || "•"} *${o.title}* \`${o.type}\` \`${o.client || ""}\` \`${o.channel}\`\n${o.detail}`,
        },
      });
    });
  }

  // Positive signals
  if (report.positive_signals?.length) {
    blocks.push({ type: "divider" });
    const signalLines = report.positive_signals.map((s) => `✅ ${s}`).join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*👍 Positive signals*\n${signalLines}` },
    });
  }

  // Footer
  blocks.push({ type: "divider" });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Channels monitored: ${channelNames.map((c) => `#${c}`).join(", ")}`,
      },
    ],
  });

  return blocks;
}

// ─── Send DM ──────────────────────────────────────────────────────────────────

async function sendDM(report, channelNames, runDate) {
  // Open a DM channel with the target user
  const dmData = await slackPost("conversations.open", {
    users: SLACK_REPORT_USER_ID,
  });
  const dmChannelId = dmData.channel.id;
  const blocks = buildBlocks(report, channelNames, runDate);

  // Slack blocks max 50 per message — chunk if needed
  const CHUNK = 50;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    await slackPost("chat.postMessage", {
      channel: dmChannelId,
      blocks: blocks.slice(i, i + CHUNK),
      text: `Pulse check — ${runDate}`, // fallback for push notifications
    });
  }

  console.log(`✅ Report sent as DM to ${SLACK_REPORT_USER_ID}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔍 Slack Pulse Check starting...`);
  console.log(`   Channels : ${CHANNELS.join(", ")}`);
  console.log(`   Lookback : ${LOOKBACK_DAYS} days`);
  console.log(`   Lens     : ${FOCUS_LENS}`);
  console.log(`   Send to  : ${SLACK_REPORT_USER_ID}`);

  // 1. Fetch messages
  console.log("\n📥 Fetching Slack messages...");
  const channelData = [];
  for (const ch of CHANNELS) {
    try {
      process.stdout.write(`   #${ch}... `);
      const result = await fetchMessages(ch);
      channelData.push(result);
      console.log(`${result.messages.length} messages`);
    } catch (err) {
      console.error(`\n   ⚠️  Skipping #${ch}: ${err.message}`);
    }
  }

  if (!channelData.length) {
    throw new Error("No channel data retrieved — check token and channel names.");
  }

  // 2. Analyse with Claude
  console.log("\n🤖 Analysing with Claude...");
  const report = await analyse(channelData);
  console.log(
    `   Health: ${report.overall_health} · ${report.concerns?.length || 0} concerns · ${report.opportunities?.length || 0} opportunities`
  );

  // 3. Send DM
  const runDate = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  console.log("\n💬 Sending Slack DM...");
  await sendDM(report, CHANNELS, runDate);

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
