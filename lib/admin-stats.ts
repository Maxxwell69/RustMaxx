import { query } from "./db";

export type AdminStats = {
  totalUsers: number;
  totalServers: number;
  usersByRole: Record<string, number>;
};

export async function getAdminStats(): Promise<AdminStats> {
  const [usersRes, serversRes] = await Promise.all([
    query<{ role: string; count: string }>(
      "SELECT role, count(*)::text AS count FROM users GROUP BY role"
    ),
    query<{ count: string }>("SELECT count(*)::text AS count FROM servers"),
  ]);

  const usersByRole: Record<string, number> = {};
  for (const row of usersRes.rows) {
    usersByRole[row.role] = parseInt(row.count, 10);
  }
  const totalUsers = usersRes.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
  const totalServers = parseInt(serversRes.rows[0]?.count ?? "0", 10);

  return { totalUsers, totalServers, usersByRole };
}
