import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { mockAssetWorkspaceData } from "../app/assets/lib/asset-workspace-mock-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const dbDir = join(rootDir, "db", "local");
const dbPath = join(dbDir, "multimix.sqlite");
const schemaPath = join(rootDir, "db", "schema.sql");

mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(readFileSync(schemaPath, "utf8"));
db.exec("BEGIN");

try {
  db.exec(`
    DELETE FROM messages;
    DELETE FROM products;
    DELETE FROM conversations;
    DELETE FROM sources;
    DELETE FROM workshops;
    DELETE FROM local_users;
  `);

  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, title, type, updated_at, asset_label, status, prompt, response, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (conversation_id, role, text, suggestions_json, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertProduct = db.prepare(`
    INSERT INTO products (id, conversation_id, mode, title, status, ratio, duration, phase, version, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSource = db.prepare(`
    INSERT INTO sources (id, title, kind, status, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertWorkshop = db.prepare(`
    INSERT INTO workshops (id, title, description, payload_json)
    VALUES (?, ?, ?, ?)
  `);
  const insertUser = db.prepare(`
    INSERT INTO local_users (email, display_name, created_at)
    VALUES (?, ?, ?)
  `);

  for (const conversation of mockAssetWorkspaceData.conversations) {
    insertConversation.run(
      conversation.id,
      conversation.title,
      conversation.type,
      conversation.updatedAt,
      conversation.assetLabel,
      conversation.status,
      conversation.prompt,
      conversation.response,
      JSON.stringify(conversation)
    );

    const messages = conversation.messages ?? [
      { role: "user" as const, text: conversation.prompt },
      { role: "assistant" as const, text: conversation.response, suggestions: conversation.suggestions }
    ];
    messages.forEach((message, index) => {
      insertMessage.run(
        conversation.id,
        message.role,
        message.text,
        JSON.stringify(message.suggestions ?? []),
        index
      );
    });

    const products = conversation.products && conversation.products.length > 0 ? conversation.products : [conversation.product];
    for (const product of products) {
      insertProduct.run(
        `${conversation.id}:${product.id}`,
        conversation.id,
        product.mode,
        product.title,
        product.status,
        product.ratio,
        product.duration,
        product.phase,
        product.version ?? null,
        JSON.stringify(product)
      );
    }
  }

  for (const source of mockAssetWorkspaceData.sources) {
    insertSource.run(source.id, source.title, source.kind, source.status, JSON.stringify(source));
  }

  for (const [id, workshop] of Object.entries(mockAssetWorkspaceData.workshops)) {
    insertWorkshop.run(id, workshop.title, workshop.description, JSON.stringify(workshop));
  }

  insertUser.run("demo@multimix.local", "MultiMix Demo", new Date().toISOString());
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(`Seeded local MultiMix database: ${dbPath}`);
