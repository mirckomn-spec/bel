import "server-only";
import { MongoClient } from "mongodb";

const globalWithMongo = global as typeof globalThis & {
  mongoClientPromise?: Promise<MongoClient>;
};

function cleanEnv(value: string | undefined): string {
  if (!value) return "";
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function getMongoUri() {
  const uri = cleanEnv(process.env.MONGODB_URI);
  if (!uri) {
    throw new Error("Defina MONGODB_URI nas variaveis de ambiente.");
  }
  return uri;
}

function toFriendlyMongoError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("authentication failed") || lower.includes("bad auth")) {
    return "Autenticacao do MongoDB falhou. Confira usuario e senha em MONGODB_URI (na Vercel). Se a senha tiver @, # ou %, use a versao codificada na URL.";
  }
  return message;
}

function getMongoDbName() {
  const name = process.env.MONGODB_DB_NAME?.trim();
  return name && name.length > 0 ? name : "hots";
}

function getMongoClientPromise(): Promise<MongoClient> {
  if (!globalWithMongo.mongoClientPromise) {
    const client = new MongoClient(getMongoUri(), {
      serverSelectionTimeoutMS: 15_000,
      maxPoolSize: 10,
    });
    globalWithMongo.mongoClientPromise = client.connect().catch((err) => {
      globalWithMongo.mongoClientPromise = undefined;
      throw err;
    });
  }
  return globalWithMongo.mongoClientPromise;
}

export async function getDb() {
  const client = await getMongoClientPromise();
  return client.db(getMongoDbName());
}

export async function getDbSafe() {
  try {
    const db = await getDb();
    return { db, error: null as string | null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao conectar no MongoDB.";
    return { db: null, error: message };
  }
}

export class MongoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoUnavailableError";
  }
}

export async function getDbRequired() {
  const { db, error } = await getDbSafe();
  if (!db) {
    throw new MongoUnavailableError(
      toFriendlyMongoError(
        error ?? "MongoDB indisponivel. Defina MONGODB_URI e verifique a rede.",
      ),
    );
  }
  return db;
}
