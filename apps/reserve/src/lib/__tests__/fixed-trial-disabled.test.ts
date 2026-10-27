import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withPhp } from "./php/server";

const h = withPhp();
describe("固定試験拡張の無効状態での配布", () => {
  it("配布に必要な5ファイルとAPI経路を含み、有効な承認を同梱しない", async () => {
    const { stdout } = await promisify(execFile)("php", ["php/tools/check-fixed-trial-package.php"]);
    expect(JSON.parse(stdout)).toEqual({ status: "verified", disabled: true, files: 5, databaseAccess: false });
  });
  it("認証なしを拒否し、正しい予約鍵でも無効policyでは患者・予約を書き換えない", async () => {
    const staff = await h.srv.as("staff-admin");
    const { token } = await staff.post("/device-links", { source: "booking", name: "合成試験" });
    const snapshot = () => h.srv.php("return ['patients'=>Db::i()->all('patient'),'reservations'=>Db::i()->all('reservation'),'receipts'=>Db::i()->all('safePatientReceipt')];");
    const before = await snapshot();
    const routes = [
      ["POST", "safe-mutations"],
      ["POST", "safe-patients"],
      ["GET", "safe-patients?requestId=R20261027SyntheticOnly01&identityHash=" + "a".repeat(64)],
    ];
    for (const [method, route] of routes) {
      const body = method === "POST" ? {} : undefined;
      const path = "/api/v1/integration/booking/" + route;
      expect((await h.srv.client().raw(method, path, body)).status).toBe(401);
      expect((await h.srv.client().raw(method, path, body, { "X-Booking-Token": token })).status).toBe(409);
    }
    expect(await snapshot()).toEqual(before);
  });
});
