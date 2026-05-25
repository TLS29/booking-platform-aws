/**
 * Demo del Listing rich entity.
 * Correr con: pnpm tsx scripts/demo-listing.ts
 *
 * Ojo: este archivo no es parte de la app, es solo para ver la entidad
 * funcionando en vivo. Se puede borrar cuando ya no lo necesites.
 */

import { Listing } from "#domain/entities/listing";
import { DomainError } from "#domain/errors/DomainError";

function section(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

// ---------- 1. Crear un listing válido ----------
section("1. Listing.create(...) con datos válidos");

const listing = Listing.create({
  hostId: "host-uuid-fake-123",
  title: "Cabaña con vista al lago",
  description: "Hermosa cabaña a 5 min del lago",
  pricePerNight: 150_00n,        // 150.00 en cents → BigInt
  currency: "mxn",                // verás cómo se vuelve "MXN" en mayúsculas
  maxCapacity: 4,
  city: "Valle de Bravo",
  country: "Mexico",
});

console.log("id:           ", listing.id);
console.log("title:        ", listing.title);
console.log("currency:     ", listing.currency, "← se normalizó a mayúsculas");
console.log("isPublished:  ", listing.isPublished, "← arranca en false");
console.log("version:      ", listing.version, "← arranca en 0");
console.log("createdAt:    ", listing.createdAt);

// ---------- 2. Intentar crear con datos inválidos ----------
section("2. Listing.create(...) con title vacío → debe fallar");

try {
  Listing.create({
    hostId: "host-uuid-fake-123",
    title: "   ",                // solo espacios
    description: "",
    pricePerNight: 100n,
    currency: "USD",
    maxCapacity: 1,
    city: "X",
    country: "X",
  });
  console.log("❌ No falló (mal, debería haber fallado)");
} catch (err) {
  if (err instanceof DomainError) {
    console.log("✅ Falló como esperado:");
    console.log("   code:   ", err.code);
    console.log("   message:", err.message);
    console.log("   status: ", err.status);
  } else {
    throw err;
  }
}

// ---------- 3. Publicar el listing ----------
section("3. listing.publish() → cambia isPublished y version");

console.log("Antes: isPublished =", listing.isPublished, ", version =", listing.version);
listing.publish();
console.log("Después: isPublished =", listing.isPublished, ", version =", listing.version);
console.log("           updatedAt =", listing.updatedAt);

// ---------- 4. Publicar dos veces → debe fallar ----------
section("4. listing.publish() segunda vez → debe fallar");

try {
  listing.publish();
  console.log("❌ No falló (mal)");
} catch (err) {
  if (err instanceof DomainError) {
    console.log("✅ Falló como esperado:");
    console.log("   code:   ", err.code);
    console.log("   message:", err.message);
  } else {
    throw err;
  }
}

// ---------- 5. Cambiar precio → version sube otra vez ----------
section("5. listing.updatePricing(...) → version sube");

listing.updatePricing(200_00n, "USD");
console.log("pricePerNight:", listing.pricePerNight);
console.log("currency:     ", listing.currency);
console.log("version:      ", listing.version, "← debe ser 2 ahora");

// ---------- 6. Reconstituir desde "DB" ----------
section("6. Listing.reconstitute(...) — simula leer de DB");

const fromDb = Listing.reconstitute({
  id: "uuid-que-vino-de-la-db",
  hostId: "host-uuid-123",
  title: "Listing viejo",
  description: "Existe en DB desde hace tiempo",
  pricePerNight: 99_00n,
  currency: "EUR",
  maxCapacity: 2,
  isPublished: true,
  city: "Madrid",
  country: "Spain",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-06-01"),
  deletedAt: null,
  version: 5,
});

console.log("id:          ", fromDb.id, "← respeta el ID de DB, no genera uno nuevo");
console.log("version:     ", fromDb.version, "← respeta version de DB");
console.log("isPublished: ", fromDb.isPublished, "← arranca en true (estado real de DB)");

// ---------- 7. Demostrar que el constructor es privado ----------
section("7. ¿Y el constructor privado?");
console.log("No se puede hacer 'new Listing(...)' desde aquí — TypeScript marca error.");
console.log("Si descomentas la línea de abajo, no compila:");
console.log("// const x = new Listing(...);");
