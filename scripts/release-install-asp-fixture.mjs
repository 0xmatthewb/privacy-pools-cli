import { createServer } from "node:http";

const GLOBAL_STATISTICS = {
  cacheTimestamp: "2025-01-01T00:00:00.000Z",
  allTime: {
    tvlUsd: "150000",
    avgDepositSizeUsd: "3000",
    totalDepositsCount: 100,
    totalWithdrawalsCount: 50,
    totalDepositsValue: "200000000000000000000",
    totalWithdrawalsValue: "100000000000000000000",
    totalDepositsValueUsd: "600000",
    totalWithdrawalsValueUsd: "300000",
  },
  last24h: {
    tvlUsd: "150000",
    avgDepositSizeUsd: "3000",
    totalDepositsCount: 5,
    totalWithdrawalsCount: 2,
    totalDepositsValue: "10000000000000000000",
    totalWithdrawalsValue: "4000000000000000000",
    totalDepositsValueUsd: "30000",
    totalWithdrawalsValueUsd: "12000",
  },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/global/public/statistics") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(GLOBAL_STATISTICS));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    process.stderr.write("failed to resolve fixture port\n");
    process.exit(1);
    return;
  }

  process.stdout.write(`FIXTURE_PORT=${address.port}\n`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
