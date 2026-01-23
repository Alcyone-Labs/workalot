#!/usr/bin/env bun
/**
 * Workalot Dashboard Server - Standalone
 *
 * Usage:
 *   WORKALOT_API_URL=http://localhost:3000 bun run standalone-server.ts
 */

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";

let API_BASE = process.env.WORKALOT_API_URL || "http://localhost:3000";

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workalot Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .fade-in { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  </style>
</head>
<body class="bg-gray-900 text-white">
  <div id="root"></div>
  <script type="text/babel">
    const e = React.useState, t = React.useEffect, n = React.useCallback;
    let API_BASE = "/api";

    async function get(path) {
      try { return await fetch(API_BASE + "/" + path).then(r => r.json()); } catch (i) { return { error: i.message }; }
    }

    async function post(path, body) {
      try { return await fetch(API_BASE + "/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()); } catch (i) { return { error: i.message }; }
    }

    function c(status) {
      if (status === "completed") return "bg-green-500";
      if (status === "failed") return "bg-red-500";
      if (status === "processing") return "bg-yellow-500";
      return "bg-blue-500";
    }

    function l(status) {
      if (status === "completed") return "Completed";
      if (status === "failed") return "Failed";
      if (status === "processing") return "Processing";
      return "Pending";
    }

    function SvgLineChart(r) {
      const a = r.data, i = r.dataKey, o = r.color;
      if (!a || a.length === 0) return React.createElement("div", { className: "h-48 flex items-center justify-center text-gray-500" }, "No data");
      const u = 600, s = 200, f = 30;
      const p = a.map((r, a) => r[i] || 0);
      const h = Math.max(...p, 1), d = 0, g = h - d || 1;
      const len = Math.max(a.length, 1);
      const m = a.map((r, a) => {
        const e = f + (a / (len - 1 || 1)) * (u - f * 2);
        const t = s - f - ((r[i] - d) / g) * (s - f * 2);
        return { x: e, y: t, value: r[i], time: r.timestamp };
      }).filter(r => !isNaN(r.x) && !isNaN(r.y));
      if (m.length === 0) return React.createElement("div", { className: "h-48 flex items-center justify-center text-gray-500" }, "No valid data");
      const y = m.map((r, a) => (a === 0 ? "M" : "L") + r.x + "," + r.y).join(" ");
      const v = "grad-" + i;
      return React.createElement("svg", { viewBox: "0 0 " + u + " " + s, className: "w-full h-48" },
        React.createElement("defs", null,
          React.createElement("linearGradient", { id: v, x1: "0%", y1: "0%", x2: "0%", y2: "100%" },
            React.createElement("stop", { offset: "0%", stopColor: o, stopOpacity: "0.3" }),
            React.createElement("stop", { offset: "100%", stopColor: o, stopOpacity: "0" })
          )
        ),
        [0, 0.25, 0.5, 0.75, 1].map(r => {
          const a = s - f - r * (s - f * 2);
          return React.createElement("g", { key: r },
            React.createElement("line", { x1: f, y1: a, x2: u - f, y2: a, stroke: "#374151", strokeDasharray: "3,3" }),
            React.createElement("text", { x: f - 5, y: a + 4, textAnchor: "end", fill: "#9CA3AF", fontSize: "10" }, Math.round(d + r * g))
          );
        }),
        React.createElement("path", { d: y + " L" + (u - f) + "," + (s - f) + " L" + f + "," + (s - f) + " Z", fill: "url(#" + v + ")" }),
        React.createElement("path", { d: y, fill: "none", stroke: o, strokeWidth: "2" }),
        m.map((r, a) => React.createElement("circle", { key: a, cx: r.x, cy: r.y, r: "3", fill: o }))
      );
    }

    function SvgPieChart(r) {
      const a = r.data;
      if (!a || a.length === 0) return React.createElement("div", { className: "h-36 flex items-center justify-center text-gray-500" }, "No workers");
      const i = a.reduce((r, a) => r + a.value, 0);
      if (i === 0) return React.createElement("div", { className: "h-36 flex items-center justify-center text-gray-500" }, "No workers");
      let o = 0, u = 50, s = 100, f = 70;
      const p = { Available: "#10B981", Busy: "#F59E0B" };
      return React.createElement("svg", { viewBox: "0 0 200 140", className: "w-full h-36" },
        a.map(r => {
          const a = (r.value / i) * 2 * Math.PI;
          const e = o, t = o + a;
          o = t;
          const n = e - Math.PI / 2, c = t - Math.PI / 2;
          const l = s + u * Math.cos(n), h = f + u * Math.sin(n);
          const d = s + u * Math.cos(c), g = f + u * Math.sin(c);
          const m = a > Math.PI ? 1 : 0;
          return React.createElement("g", { key: r.name },
            React.createElement("path", { d: "M" + s + "," + f + " L" + l + "," + h + " A" + u + "," + u + " 0 " + m + ",1 " + d + "," + g + " Z", fill: p[r.name] || "#6B7280", stroke: "#1F2937", strokeWidth: "1" })
          );
        }),
        React.createElement("text", { x: s, y: f + 5, textAnchor: "middle", fill: "white", fontSize: "14", fontWeight: "bold" }, i),
        React.createElement("text", { x: s, y: f + 20, textAnchor: "middle", fill: "#9CA3AF", fontSize: "10" }, "Total")
      );
    }

    function ServerInput(r) {
      const a = r.url, i = r.onUrlChange, o = r.onConnect;
      const u = e(""), s = u[0], f = u[1];
      return React.createElement("div", { className: "flex items-center gap-2" },
        React.createElement("input", { 
          type: "text", 
          value: s, 
          onChange: r => f(r.target.value),
          placeholder: "http://localhost:3000",
          className: "bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm w-48 text-white placeholder-gray-500"
        }),
        React.createElement("button", { 
          onClick: () => { if (s) { i(s); o(); } },
          className: "px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
        }, "Connect")
      );
    }

    function Header(r) {
      const a = r.health, i = r.modes, o = r.lastUpdated, u = r.serverUrl, s = r.onServerUrlChange, f = r.onReconnect, d = r.streamError;
      const g = a === "healthy";
      return React.createElement("header", { className: "bg-gray-800 border-b border-gray-700 px-6 py-4" },
        React.createElement("div", { className: "flex items-center justify-between flex-wrap gap-4" },
          React.createElement("div", { className: "flex items-center gap-4 flex-wrap" },
            React.createElement("h1", { className: "text-2xl font-bold text-white" }, "Workalot Dashboard"),
            React.createElement("span", { className: "px-3 py-1 rounded-full text-sm font-medium " + (g ? "text-green-400 bg-green-500/20" : "text-yellow-400 bg-yellow-500/20") }, g ? "Healthy" : "Degraded"),
            i.draining && React.createElement("span", { className: "px-3 py-1 rounded-full text-sm font-medium bg-orange-500 text-white" }, "Draining"),
            d ? React.createElement("span", { className: "px-3 py-1 rounded-full text-sm font-medium bg-red-500/20 text-red-400" }, "Stream Error") : React.createElement("span", { className: "px-3 py-1 rounded-full text-sm font-medium bg-blue-500/20 text-blue-400" }, "Live")
          ),
          React.createElement("div", { className: "flex items-center gap-4 flex-wrap" },
            React.createElement(ServerInput, { url: u, onUrlChange: s, onReconnect: f }),
            React.createElement("span", { className: "text-gray-400 text-sm" }, "Updated: " + (o ? new Date(o).toLocaleTimeString() : "-"))
          )
        )
      );
    }

    function StatCard(r) {
      const a = r.title, i = r.value, o = r.color;
      const u = { blue: "border-blue-500", green: "border-green-500", yellow: "border-yellow-500", red: "border-red-500" };
      return React.createElement("div", { className: "bg-gray-800 rounded-lg p-4 border-l-4 " + u[o] + " fade-in" },
        React.createElement("p", { className: "text-gray-400 text-sm" }, a),
        React.createElement("p", { className: "text-3xl font-bold mt-1" }, i)
      );
    }

    function QueueChart(r) {
      const a = e([]), i = a[0], o = a[1];
      const u = r.range, s = r.onRangeChange;
      t(() => {
        function r() { o([]); get("queue/history?range=" + u).then(r => { if (r.history) o(r.history); }); }
        r();
      }, [u]);
      return React.createElement("div", { className: "bg-gray-800 rounded-lg p-6" },
        React.createElement("div", { className: "flex items-center justify-between mb-4" },
          React.createElement("h2", { className: "text-lg font-semibold" }, "Queue History"),
          React.createElement("div", { className: "flex gap-2" },
            ["5m", "15m", "1h", "24h"].map(r =>
              React.createElement("button", { key: r, onClick: () => s(r), className: "px-3 py-1 rounded text-sm " + (u === r ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600") }, r)
            )
          )
        ),
        i.length === 0 ? React.createElement("div", { className: "h-48 flex items-center justify-center text-gray-500" }, "Loading...") :
        React.createElement("div", null,
          React.createElement("div", { className: "mb-4" },
            React.createElement("p", { className: "text-xs text-gray-500 mb-1" }, "Pending Jobs"),
            React.createElement(SvgLineChart, { data: i, dataKey: "pending", color: "#3B82F6" })
          ),
          React.createElement("div", null,
            React.createElement("p", { className: "text-xs text-gray-500 mb-1" }, "Processing Jobs"),
            React.createElement(SvgLineChart, { data: i, dataKey: "processing", color: "#F59E0B" })
          )
        )
      );
    }

    function JobsList() {
      const r = e([]), a = r[0], i = r[1], o = e("all"), u = o[0], s = o[1], f = e({}), p = f[0], h = f[1];
      const y = n(() => {
        function r() { get("jobs" + (u === "all" ? "?" : "?status=" + u + "&") + "limit=100").then(r => { if (r.jobs) i(r.jobs); }); }
        r();
      }, [u]);
      t(y, [y]);
      const v = async r => { await post("jobs/" + r + "/retry"); y(); };
      const b = async r => { await post("jobs/" + r + "/kill"); y(); };
      const w = r => {
        const a = p[r];
        if (a) { h(Object.assign({}, p, { [r]: !a })); } else { h(Object.assign({}, p, { [r]: true })); }
      };
      const k = r => {
        if (!r) return "-";
        const a = new Date(r);
        return a.toLocaleTimeString() + "." + a.getMilliseconds().toString().padStart(3, "0");
      };
      const C = r => { if (!r) return "-"; return r.executionTime ? r.executionTime + "ms" : "-"; };
      return React.createElement("div", { className: "bg-gray-800 rounded-lg p-6" },
        React.createElement("div", { className: "flex items-center justify-between mb-4" },
          React.createElement("h2", { className: "text-lg font-semibold" }, "Jobs"),
          React.createElement("div", { className: "flex items-center gap-3" },
            React.createElement("select", { value: u, onChange: r => { s(r.target.value); y(); }, className: "bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm" },
              React.createElement("option", { value: "all" }, "All (" + a.length + ")"),
              React.createElement("option", { value: "pending" }, "Pending (" + (a.filter ? a.filter(x => x.status === "pending").length : "-") + ")"),
              React.createElement("option", { value: "processing" }, "Processing"),
              React.createElement("option", { value: "completed" }, "Completed"),
              React.createElement("option", { value: "failed" }, "Failed")
            ),
            React.createElement("button", { onClick: y, className: "px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors" }, "Refresh")
          )
        ),
        React.createElement("div", { className: "space-y-1" },
          a.length === 0 ? React.createElement("div", { className: "text-gray-500 text-center py-8" }, "No jobs found") :
          React.createElement("div", { className: "max-h-96 overflow-y-auto pr-2" },
            a.map(r => React.createElement("div", { key: r.id, className: "bg-gray-700/50 rounded-lg mb-1" },
              React.createElement("div", { className: "p-3 flex items-center justify-between cursor-pointer", onClick: () => w(r.id) },
                React.createElement("div", { className: "flex items-center gap-3 flex-1 min-w-0" },
                  React.createElement("span", { className: "px-2 py-1 rounded text-xs font-medium shrink-0 " + c(r.status) + " text-white" }, l(r.status)),
                  React.createElement("div", { className: "min-w-0" },
                    React.createElement("p", { className: "font-mono text-sm text-gray-300 truncate" }, r.id),
                    React.createElement("p", { className: "text-xs text-gray-500 truncate" }, r.jobFile)
                  )
                ),
                React.createElement("div", { className: "flex items-center gap-3 text-xs text-gray-400 shrink-0" },
                  React.createElement("span", null, k(r.requestedAt)),
                  React.createElement("span", null, C(r.result)),
                  React.createElement("span", { className: "transform transition-transform " + (p[r.id] ? "rotate-180" : "") }, "▼")
                )
              ),
              p[r.id] && React.createElement("div", { className: "px-3 pb-3 pt-0 border-t border-gray-600/50" },
                React.createElement("div", { className: "mt-2 space-y-2" },
                  React.createElement("div", null,
                    React.createElement("p", { className: "text-xs text-gray-500" }, "Payload"),
                    React.createElement("pre", { className: "bg-gray-900 rounded p-2 text-xs text-gray-300 overflow-x-auto" }, JSON.stringify(r.jobPayload || {}, null, 2))
                  ),
                  r.result && React.createElement("div", null,
                    React.createElement("p", { className: "text-xs text-gray-500" }, "Result"),
                    React.createElement("pre", { className: "bg-gray-900 rounded p-2 text-xs text-gray-300 overflow-x-auto" }, JSON.stringify(r.result, null, 2))
                  ),
                  React.createElement("div", { className: "grid grid-cols-2 gap-2 text-xs" },
                    React.createElement("div", null, React.createElement("span", { className: "text-gray-500" }, "Requested: "), React.createElement("span", { className: "text-gray-300" }, k(r.requestedAt))),
                    React.createElement("div", null, React.createElement("span", { className: "text-gray-500" }, "Started: "), React.createElement("span", { className: "text-gray-300" }, k(r.startedAt))),
                    React.createElement("div", null, React.createElement("span", { className: "text-gray-500" }, "Completed: "), React.createElement("span", { className: "text-gray-300" }, k(r.completedAt))),
                    React.createElement("div", null, React.createElement("span", { className: "text-gray-500" }, "Execution: "), React.createElement("span", { className: "text-gray-300" }, C(r.result)))
                  )
                ),
                React.createElement("div", { className: "flex gap-2 mt-3" },
                  r.status === "failed" && React.createElement("button", { onClick: e => { e.stopPropagation(); v(r.id); }, className: "px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs transition-colors" }, "Retry"),
                  r.status === "processing" && React.createElement("button", { onClick: e => { e.stopPropagation(); b(r.id); }, className: "px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors" }, "Kill")
                )
              )
            ))
          )
        )
      );
    }

    function WorkerStats(r) {
      const a = r.workers;
      const o = [
        { name: "Available", value: a.available || 0 },
        { name: "Busy", value: a.busy || 0 }
      ];
      return React.createElement("div", { className: "bg-gray-800 rounded-lg p-6" },
        React.createElement("h2", { className: "text-lg font-semibold mb-4" }, "Workers"),
        React.createElement("div", { className: "grid grid-cols-2 gap-4 mb-4" },
          React.createElement("div", { className: "text-center" },
            React.createElement("p", { className: "text-4xl font-bold text-blue-400" }, a.total || 0),
            React.createElement("p", { className: "text-gray-400 text-sm" }, "Total")
          ),
          React.createElement("div", { className: "text-center" },
            React.createElement("p", { className: "text-4xl font-bold text-green-400" }, a.available || 0),
            React.createElement("p", { className: "text-gray-400 text-sm" }, "Available")
          )
        ),
        React.createElement(SvgPieChart, { data: o })
      );
    }

    function QuickActions(r) {
      const a = r.modes, i = r.onRefresh;
      const o = async () => { if (confirm("Drain queue?")) { await post("queue/drain"); i(); } };
      const u = async () => { await post("queue/resume"); i(); };
      const s = async () => { const r = await post("recovery/trigger"); alert("Recovered: " + (r.jobsRecovered || 0)); };
      return React.createElement("div", { className: "bg-gray-800 rounded-lg p-6" },
        React.createElement("h2", { className: "text-lg font-semibold mb-4" }, "Quick Actions"),
        React.createElement("div", { className: "flex flex-wrap gap-3" },
          React.createElement("button", { onClick: o, disabled: a.draining, className: "px-4 py-2 rounded font-medium transition-colors " + (a.draining ? "bg-gray-600 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700") }, "Drain Queue"),
          React.createElement("button", { onClick: u, disabled: !a.draining, className: "px-4 py-2 rounded font-medium transition-colors " + (!a.draining ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-700") }, "Resume Queue"),
          React.createElement("button", { onClick: s, className: "px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded font-medium transition-colors" }, "Trigger Recovery")
        )
      );
    }

    function App() {
      const r = e({ queue: {}, workers: {} }), a = r[0], i = r[1], o = e("healthy"), u = o[0], s = o[1], f = e({ draining: !1 }), p = f[0], h = f[1], d = e(null), g = d[0], m = d[1], y = e("http://localhost:3000"), v = y[0], b = y[1], w = e("1h"), k = w[0], C = w[1], x = e(!1), E = x[0], P = x[1];
      const S = n(() => {
        get("status").then(r => { s(r.status || "healthy"); h(r.queue?.modes || { draining: !1 }); });
        get("queue/stats").then(r => { i(r); m(new Date().toISOString()); });
      }, []);
      t(() => {
        S();
        const eventSource = new EventSource("/api/stream");
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "stats" || data.type === "heartbeat" || data.type.startsWith("job-")) {
              i(data.data || data);
              m(new Date().toISOString());
            }
          } catch (e) {}
        };
        eventSource.onerror = () => { P(!0); };
        return () => { eventSource.close(); };
      }, [S]);
      const j = a.queue || {}, _ = a.workers || 0;
      return React.createElement("div", { className: "min-h-screen bg-gray-900" },
        React.createElement(Header, { health: u, modes: p, lastUpdated: g, serverUrl: v, onServerUrlChange: b, onReconnect: S, streamError: E }),
        React.createElement("main", { className: "p-6" },
          React.createElement("div", { className: "grid grid-cols-2 md:grid-cols-5 gap-4 mb-6" },
            React.createElement(StatCard, { title: "Total Jobs", value: j.total || 0, color: "blue" }),
            React.createElement(StatCard, { title: "Pending", value: j.pending || 0, color: "blue" }),
            React.createElement(StatCard, { title: "Processing", value: j.processing || 0, color: "yellow" }),
            React.createElement(StatCard, { title: "Completed", value: j.completed || 0, color: "green" }),
            React.createElement(StatCard, { title: "Failed", value: j.failed || 0, color: "red" })
          ),
          React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6" },
            React.createElement(QueueChart, { range: k, onRangeChange: C }),
            React.createElement(WorkerStats, { workers: _ })
          ),
          React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6" },
            React.createElement(JobsList),
            React.createElement(QuickActions, { modes: p, onRefresh: S })
          )
        )
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
  </script>
</body>
</html>`;

const app = new Elysia()
  .use(cors())
  .use(staticPlugin({ assets: "examples/dashboard", prefix: "/dashboard" }))
  .get("/api/health", async () => {
    try {
      return await fetch(API_BASE + "/health").then((r) => r.json());
    } catch {
      return {
        status: "error",
        message: "Cannot connect to Workalot API",
        timestamp: new Date().toISOString(),
      };
    }
  })
  .get("/api/stream", async ({ request }) => {
    const targetUrl = API_BASE + "/api/stream";
    try {
      const res = await fetch(targetUrl);
      return new Response(res.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    } catch {
      return new Response(
        `data: ${JSON.stringify({ type: "error", message: "Cannot connect to Workalot API" })}\n\n`,
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        }
      );
    }
  })
  .all("/api/*", async ({ request }) => {
    const url = new URL(request.url);
    const proxyPath = url.pathname.replace("/api", "");
    const query = url.search;
    try {
      const targetUrl = API_BASE + "/api" + proxyPath + query;
      const res = await fetch(targetUrl);
      const data = await res.json();
      return data;
    } catch (e) {
      return { error: "Failed to fetch from Workalot API", details: String(e) };
    }
  })
  .get(
    "/dashboard",
    () => new Response(DASHBOARD_HTML, { headers: { "Content-Type": "text/html" } }),
  )
  .listen(3001);

console.log("Workalot Dashboard Server Running");
console.log("Dashboard: http://localhost:3001/dashboard");
console.log("API: http://localhost:3001/api");
console.log("Workalot API: " + API_BASE);
