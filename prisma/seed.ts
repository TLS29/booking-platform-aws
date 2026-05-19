import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const USER_IDS = {
  alice: '00000000-0000-7000-8000-000000000001',
  bob: '00000000-0000-7000-8000-000000000002',
  carol: '00000000-0000-7000-8000-000000000003',
};

async function clearDatabase() {
  await prisma.payment.deleteMany();
  await prisma.review.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUsers() {
  await prisma.user.createMany({
    data: [
      {
        id: USER_IDS.alice,
        email: 'alice@example.com',
        name: 'Alice Host',
        passwordHash: 'fake-hash-replace-in-epic-02',
        isHost: true,
        isGuest: false,
      },
      {
        id: USER_IDS.bob,
        email: 'bob@example.com',
        name: 'Bob Host-Guest',
        passwordHash: 'fake-hash-replace-in-epic-02',
        isHost: true,
        isGuest: true,
      },
      {
        id: USER_IDS.carol,
        email: 'carol@example.com',
        name: 'Carol Guest',
        passwordHash: 'fake-hash-replace-in-epic-02',
        isHost: false,
        isGuest: true,
      },
    ],
  });
}

async function seedListings() {
  const listingsData = [
    { title: 'Loft moderno en Roma Norte',     city: 'Ciudad de México', country: 'MX', pricePerNight: 95000,  hostId: USER_IDS.alice },
    { title: 'Casa con alberca en Tulum',      city: 'Tulum',            country: 'MX', pricePerNight: 180000, hostId: USER_IDS.alice },
    { title: 'Departamento frente al mar',     city: 'Puerto Vallarta',  country: 'MX', pricePerNight: 120000, hostId: USER_IDS.alice },
    { title: 'Cabaña en el bosque',            city: 'San Cristóbal',    country: 'MX', pricePerNight: 60000,  hostId: USER_IDS.alice },
    { title: 'Estudio céntrico',               city: 'Guadalajara',      country: 'MX', pricePerNight: 50000,  hostId: USER_IDS.alice },
    { title: 'Penthouse con vista',            city: 'Monterrey',        country: 'MX', pricePerNight: 220000, hostId: USER_IDS.alice },
    { title: 'Apartamento en Polanco',         city: 'Ciudad de México', country: 'MX', pricePerNight: 150000, hostId: USER_IDS.bob },
    { title: 'Villa frente al mar',            city: 'Playa del Carmen', country: 'MX', pricePerNight: 250000, hostId: USER_IDS.bob },
    { title: 'Casa colonial',                  city: 'Mérida',           country: 'MX', pricePerNight: 80000,  hostId: USER_IDS.bob },
    { title: 'Habitación compartida',          city: 'Oaxaca',           country: 'MX', pricePerNight: 25000,  hostId: USER_IDS.bob },
  ];

  const created = [];
  for (const data of listingsData) {
    const listing = await prisma.listing.create({
      data: {
        title: data.title,
        description: `Excelente alojamiento en ${data.city}.`,
        pricePerNight: BigInt(data.pricePerNight),
        currency: 'MXN',
        maxCapacity: 4,
        isPublished: true,
        city: data.city,
        country: data.country,
        hostId: data.hostId,
      },
    });
    created.push(listing);
  }
  return created;
}

async function seedAvailabilities(listings: { id: string }[]) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const listing of listings) {
    for (let dayOffset = 1; dayOffset <= 5; dayOffset++) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() + dayOffset);

      await prisma.availability.create({
        data: {
          listingId: listing.id,
          date,
          status: 'AVAILABLE',
        },
      });
    }
  }
}

async function seedReservations(listings: { id: string }[]) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const reservationsData = [
    { guestId: USER_IDS.carol, listingIndex: 0, daysFromNow: 10,  nights: 2, status: 'CONFIRMED'  as const, pricePerNight: 95000  },
    { guestId: USER_IDS.carol, listingIndex: 1, daysFromNow: 30,  nights: 5, status: 'PENDING'    as const, pricePerNight: 180000 },
    { guestId: USER_IDS.bob,   listingIndex: 2, daysFromNow: 60,  nights: 3, status: 'HELD'       as const, pricePerNight: 120000, holdMinutes: 10 },
    { guestId: USER_IDS.carol, listingIndex: 3, daysFromNow: -30, nights: 2, status: 'COMPLETED'  as const, pricePerNight: 60000  },
    { guestId: USER_IDS.bob,   listingIndex: 4, daysFromNow: 5,   nights: 1, status: 'CANCELLED'  as const, pricePerNight: 50000  },
    { guestId: USER_IDS.carol, listingIndex: 5, daysFromNow: 0,   nights: 4, status: 'CHECKED_IN' as const, pricePerNight: 220000 },
  ];

  for (const r of reservationsData) {
    const checkIn = new Date(today);
    checkIn.setUTCDate(today.getUTCDate() + r.daysFromNow);

    const checkOut = new Date(checkIn);
    checkOut.setUTCDate(checkIn.getUTCDate() + r.nights);

    const total = BigInt(r.pricePerNight * r.nights);

    const holdExpiresAt = 'holdMinutes' in r && r.holdMinutes
      ? new Date(Date.now() + r.holdMinutes * 60 * 1000)
      : null;

    await prisma.reservation.create({
      data: {
        guestId: r.guestId,
        listingId: listings[r.listingIndex].id,
        checkIn,
        checkOut,
        total,
        status: r.status,
        currency: 'MXN',
        guests: 2,
        holdExpiresAt,
      },
    });
  }
}

async function main() {
  console.log('Iniciando seed...');

  console.log('  -> limpiando DB');
  await clearDatabase();

  console.log('  -> creando users');
  await seedUsers();

  console.log('  -> creando listings');
  const listings = await seedListings();

  console.log('  -> creando availabilities');
  await seedAvailabilities(listings);

  console.log('  -> creando reservations');
  await seedReservations(listings);

  console.log('Seed completado');
}

main()
  .catch((error) => {
    console.error('Error en seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
