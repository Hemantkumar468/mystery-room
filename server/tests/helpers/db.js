/**
 * Test database connection.
 *
 * Uses MONGO_URI exactly as the app does. Some environments (locked-down CI
 * containers, corporate networks) block Node's own DNS resolver on port 53,
 * which breaks the `mongodb+srv://` scheme — SRV lookup fails even though the
 * cluster is reachable. Set MONGO_DIRECT_HOSTS (comma-separated host:port)
 * and optionally MONGO_REPLICA_SET to bypass discovery in those environments;
 * everywhere else it is unused and the plain URI is passed straight through.
 */
import dns from 'node:dns';
import mongoose from 'mongoose';

/**
 * Resolve through public DNS, as config/database.js and the migrate scripts
 * already do.
 *
 * Node asks the system resolver by default, and on a network that blocks
 * outbound port 53 every `mongodb+srv://` connection dies at
 * `querySrv ECONNREFUSED` before a single test runs — which reads as "the whole
 * suite is broken" rather than "this machine cannot look up an SRV record".
 * MONGO_DIRECT_HOSTS below is still the escape hatch for networks where even
 * this is blocked.
 */
dns.setServers(['8.8.8.8', '8.8.4.4']);

export function resolveUri(raw = process.env.MONGO_URI) {
  if (!raw) throw new Error('MONGO_URI is not set — tests need a database.');
  const hosts = process.env.MONGO_DIRECT_HOSTS;
  if (!hosts || !raw.startsWith('mongodb+srv://')) return raw;

  const rest = raw.slice('mongodb+srv://'.length);
  const at = rest.lastIndexOf('@');
  const creds = rest.slice(0, at);
  const afterHost = rest.slice(at + 1);
  const slash = afterHost.indexOf('/');
  const tail = slash === -1 ? '' : afterHost.slice(slash + 1);
  const [dbName, query = ''] = tail.split('?');

  const params = new URLSearchParams(query);
  params.set('ssl', 'true');
  params.set('authSource', 'admin');
  if (process.env.MONGO_REPLICA_SET) params.set('replicaSet', process.env.MONGO_REPLICA_SET);
  return `mongodb://${creds}@${hosts}/${dbName}?${params.toString()}`;
}

export async function connect() {
  await mongoose.connect(resolveUri(), { serverSelectionTimeoutMS: 30000 });
  return mongoose.connection;
}

export async function disconnect() {
  await mongoose.disconnect();
}

export { mongoose };
