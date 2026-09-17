import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Phase 18: this script creates well-known accounts (admin@foodbridge.com
// among them) with hardcoded, previously-published passwords - fine for a
// disposable local/CI database, catastrophic against a real one. Nothing
// upstream of this file guarantees it only ever runs in development (no
// postinstall/prepare hook calls it today, but a deploy script or a
// copy-pasted onboarding step could), so the guard lives here, at the one
// point every invocation must pass through, and does not depend on the
// target database happening to look empty.
function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: refusing to run the development seed script with NODE_ENV=production.');
    console.error(
      'This script creates accounts with known, previously-published passwords ' +
        '(including an ADMIN account) - it must never run against a real database.'
    );
    console.error('If you actually need to seed a production database, do so deliberately and');
    console.error('separately, with unique, non-public credentials - not via `npm run db:seed`.');
    process.exit(1);
  }
}

assertNotProduction();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@foodbridge.com' },
    update: {
      isActive: true,
      isApproved: true,
      name: 'Nishant Ninad Deshmukh',
    },
    create: {
      email: 'admin@foodbridge.com',
      password: adminPassword,
      name: 'Nishant Ninad Deshmukh',
      phone: '+91 98765 43210',
      location: 'Bangalore',
      organization: 'FoodBridge Foundation',
      role: 'ADMIN' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created admin:', admin.email);

  // Create donor - Hotel
  const donorPassword = await bcrypt.hash('donor123', 10);
  const donor = await prisma.user.upsert({
    where: { email: 'donor@foodbridge.com' },
    update: {},
    create: {
      email: 'donor@foodbridge.com',
      password: donorPassword,
      name: 'Rajesh Kumar',
      phone: '+91 98765 43211',
      location: 'HSR Layout, Bangalore',
      organization: 'The Grand Udupi Hotel',
      role: 'DONOR' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created donor:', donor.email);

  // Create second donor - Restaurant
  const donor2Password = await bcrypt.hash('donor2123', 10);
  const donor2 = await prisma.user.upsert({
    where: { email: 'donor2@foodbridge.com' },
    update: {},
    create: {
      email: 'donor2@foodbridge.com',
      password: donor2Password,
      name: 'Mohammad Imran',
      phone: '+91 98765 43215',
      location: 'MG Road, Bangalore',
      organization: 'Shawarma King & Family Restaurant',
      role: 'DONOR' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created donor 2:', donor2.email);

  // Create third donor - Catering
  const donor3Password = await bcrypt.hash('donor3123', 10);
  const donor3 = await prisma.user.upsert({
    where: { email: 'catering@foodbridge.com' },
    update: {},
    create: {
      email: 'catering@foodbridge.com',
      password: donor3Password,
      name: 'Suresh Babu',
      phone: '+91 98765 43220',
      location: 'Jayanagar, Bangalore',
      organization: 'Suresh Catering Services',
      role: 'DONOR' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created donor 3:', donor3.email);

  // Create NGO user 1
  const ngoPassword = await bcrypt.hash('ngo123', 10);
  const ngo = await prisma.user.upsert({
    where: { email: 'ngo@foodbridge.com' },
    update: {},
    create: {
      email: 'ngo@foodbridge.com',
      password: ngoPassword,
      name: 'Ankitaben Shah',
      phone: '+91 98765 43212',
      location: 'BTM Layout, Bangalore',
      organization: 'Ahara Foundation',
      role: 'NGO' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created NGO:', ngo.email);

  // Create NGO user 2
  const ngo2Password = await bcrypt.hash('ngo2123', 10);
  const ngo2 = await prisma.user.upsert({
    where: { email: 'ngo2@foodbridge.com' },
    update: {},
    create: {
      email: 'ngo2@foodbridge.com',
      password: ngo2Password,
      name: 'Meera Devi',
      phone: '+91 98765 43218',
      location: 'Jayanagar, Bangalore',
      organization: 'Anna Danam Trust',
      role: 'NGO' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created NGO 2:', ngo2.email);

  // Create NGO user 3
  const ngo3Password = await bcrypt.hash('ngo3123', 10);
  const ngo3 = await prisma.user.upsert({
    where: { email: 'ngo3@foodbridge.com' },
    update: {},
    create: {
      email: 'ngo3@foodbridge.com',
      password: ngo3Password,
      name: 'Father Joseph',
      phone: '+91 98765 43225',
      location: 'Koramangala, Bangalore',
      organization: 'St. Mary\'s Food Relief',
      role: 'NGO' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created NGO 3:', ngo3.email);

  // Create pending NGO
  const pendingNgoPassword = await bcrypt.hash('pending123', 10);
  const pendingNgo = await prisma.user.upsert({
    where: { email: 'pending@ngo.com' },
    update: {},
    create: {
      email: 'pending@ngo.com',
      password: pendingNgoPassword,
      name: 'Rahul Verma',
      phone: '+91 98765 43213',
      location: 'Whitefield, Bangalore',
      organization: 'Zomato Feeding Foundation',
      role: 'NGO' as const,
      isApproved: false,
      isActive: true,
    },
  });
  console.log('✅ Created pending NGO:', pendingNgo.email);

  // Create volunteer 1
  const volunteerPassword = await bcrypt.hash('volunteer123', 10);
  const volunteer = await prisma.user.upsert({
    where: { email: 'volunteer@foodbridge.com' },
    update: {},
    create: {
      email: 'volunteer@foodbridge.com',
      password: volunteerPassword,
      name: 'Prakash Reddy',
      phone: '+91 98765 43214',
      location: 'Indiranagar, Bangalore',
      organization: '',
      role: 'VOLUNTEER' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created volunteer:', volunteer.email);

  // Create volunteer 2
  const volunteer2Password = await bcrypt.hash('volunteer2123', 10);
  const volunteer2 = await prisma.user.upsert({
    where: { email: 'volunteer2@foodbridge.com' },
    update: {},
    create: {
      email: 'volunteer2@foodbridge.com',
      password: volunteer2Password,
      name: 'Amit Kumar Singh',
      phone: '+91 98765 43219',
      location: 'Whitefield, Bangalore',
      organization: '',
      role: 'VOLUNTEER' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created volunteer 2:', volunteer2.email);

  // Create volunteer 3
  const volunteer3Password = await bcrypt.hash('volunteer3123', 10);
  const volunteer3 = await prisma.user.upsert({
    where: { email: 'volunteer3@foodbridge.com' },
    update: {},
    create: {
      email: 'volunteer3@foodbridge.com',
      password: volunteer3Password,
      name: 'Siddharth Menon',
      phone: '+91 98765 43228',
      location: 'Marathahalli, Bangalore',
      organization: '',
      role: 'VOLUNTEER' as const,
      isApproved: true,
      isActive: true,
    },
  });
  console.log('✅ Created volunteer 3:', volunteer3.email);

  // ===== Create Donations from Donor 1 (The Grand Udupi Hotel) =====

  // Available donation - South Indian thali
  const donation1 = await prisma.donation.create({
    data: {
      foodType: 'South Indian Thali',
      quantity: '60 plates',
      description: 'Rice, dal, sambar, vegetable curry, pickle, papad, and curd. Freshly prepared this morning.',
      expiryTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      pickupLocation: 'The Grand Udupi Hotel, HSR Layout, Sector 1, Near BDA Complex, Bangalore',
      status: 'AVAILABLE',
      isUrgent: false,
      imageUrl: '',
      donorId: donor.id,
    },
  });
  console.log('✅ Created donation:', donation1.foodType);

  // Available donation - Biryani (urgent)
  const donation2 = await prisma.donation.create({
    data: {
      foodType: 'Chicken Biryani',
      quantity: '80 plates',
      description: 'Special chicken biryani with raita and salan. Prepared 2 hours ago. Very fresh.',
      expiryTime: new Date(Date.now() + 45 * 60 * 1000),
      pickupLocation: 'The Grand Udupi Hotel, Indiranagar, Near CMH Road, Bangalore',
      status: 'AVAILABLE',
      isUrgent: true,
      imageUrl: '',
      donorId: donor.id,
    },
  });
  console.log('✅ Created donation:', donation2.foodType);

  // Available donation - Fruits
  const donation3 = await prisma.donation.create({
    data: {
      foodType: 'Fresh Fruits',
      quantity: '25 kg',
      description: 'Bananas, apples, oranges, and grapes. From today\'s breakfast buffet.',
      expiryTime: new Date(Date.now() + 6 * 60 * 60 * 1000),
      pickupLocation: 'The Grand Udupi Hotel, Whitefield, Near ITPL, Bangalore',
      status: 'AVAILABLE',
      isUrgent: false,
      imageUrl: '',
      donorId: donor.id,
    },
  });
  console.log('✅ Created donation:', donation3.foodType);

  // ===== Create Donations from Donor 2 (Shawarma King) =====

  // Available donation - Shawarmas
  const donation4 = await prisma.donation.create({
    data: {
      foodType: 'Shawarma & Rolls',
      quantity: '50 pieces',
      description: 'Chicken shawarma, paneer tikka rolls. Freshly made, wrapped in foil.',
      expiryTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
      pickupLocation: 'Shawarma King, MG Road, Opposite Metro Station, Bangalore',
      status: 'AVAILABLE',
      isUrgent: false,
      imageUrl: '',
      donorId: donor2.id,
    },
  });
  console.log('✅ Created donation:', donation4.foodType);

  // ===== Create Donations from Donor 3 (Suresh Catering) =====

  // Available donation - Wedding leftover
  const donation5 = await prisma.donation.create({
    data: {
      foodType: 'Wedding Catering',
      quantity: '100 portions',
      description: 'Dal makhani, paneer butter masala, jeera rice, naan, gulab jamun. From wedding function.',
      expiryTime: new Date(Date.now() + 4 * 60 * 60 * 1000),
      pickupLocation: 'Suresh Catering, Jayanagar 4th Block, Near Big Bazaar, Bangalore',
      status: 'AVAILABLE',
      isUrgent: false,
      imageUrl: '',
      donorId: donor3.id,
    },
  });
  console.log('✅ Created donation:', donation5.foodType);

  // ===== Create CLAIMED donation =====
  const claimedDonation = await prisma.donation.create({
    data: {
      foodType: 'Idli Dosa Batter & Chutney',
      quantity: '30 kg',
      description: 'Fresh idli batter, dosa batter, and coconut chutney. Made today morning.',
      expiryTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
      pickupLocation: 'The Grand Udupi Hotel, Koramangala, Near Forum Mall, Bangalore',
      status: 'CLAIMED',
      isUrgent: false,
      donorId: donor.id,
      claimedById: ngo.id,
    },
  });

  // Create pickup request
  const pickup1 = await prisma.pickupRequest.create({
    data: {
      donationId: claimedDonation.id,
      status: 'PENDING',
      scheduledAt: new Date(Date.now() + 1 * 60 * 60 * 1000),
    },
  });
  console.log('✅ Created claimed donation with pickup request');

  // ===== Create PICKED_UP donation =====
  const pickedUpDonation = await prisma.donation.create({
    data: {
      foodType: 'North Indian Thali',
      quantity: '40 plates',
      description: 'Rotis, paneer bhuna, dal fry, jeera rice, salad. Well packed in containers.',
      expiryTime: new Date(Date.now() + 1 * 60 * 60 * 1000),
      pickupLocation: 'Shawarma King, Jayanagar, Near Jayadeva Hospital, Bangalore',
      status: 'PICKED_UP',
      isUrgent: true,
      donorId: donor2.id,
      claimedById: ngo2.id,
    },
  });

  const pickup2 = await prisma.pickupRequest.create({
    data: {
      donationId: pickedUpDonation.id,
      status: 'ACCEPTED',
      scheduledAt: new Date(Date.now() - 30 * 60 * 1000),
      pickedUpAt: new Date(Date.now() - 15 * 60 * 1000),
      volunteerId: volunteer.id,
    },
  });
  console.log('✅ Created picked up donation');

  // ===== Create DELIVERED donation =====
  const deliveredDonation = await prisma.donation.create({
    data: {
      foodType: 'Khichdi & Pickle',
      quantity: '50 servings',
      description: 'Dal khichdi with ghee, mango pickle, papad, and curd. Home-style cooking.',
      expiryTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      pickupLocation: 'The Grand Udupi Hotel, Rajajinagar, Near Orion Mall, Bangalore',
      status: 'DELIVERED',
      isUrgent: false,
      donorId: donor.id,
      claimedById: ngo3.id,
    },
  });

  await prisma.pickupRequest.create({
    data: {
      donationId: deliveredDonation.id,
      status: 'ACCEPTED',
      scheduledAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      pickedUpAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      deliveredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      volunteerId: volunteer2.id,
    },
  });
  console.log('✅ Created delivered donation');

  // ===== Create another DELIVERED donation =====
  const deliveredDonation2 = await prisma.donation.create({
    data: {
      foodType: 'Soft Drinks & Water',
      quantity: '80 bottles',
      description: 'Assorted soft drinks (cola, orange, lime) and packaged water bottles. Cold.',
      expiryTime: new Date(Date.now() - 1 * 60 * 60 * 1000),
      pickupLocation: 'Suresh Catering, JP Nagar, Near RBI Layout, Bangalore',
      status: 'DELIVERED',
      isUrgent: false,
      donorId: donor3.id,
      claimedById: ngo2.id,
    },
  });

  await prisma.pickupRequest.create({
    data: {
      donationId: deliveredDonation2.id,
      status: 'ACCEPTED',
      scheduledAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      pickedUpAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      deliveredAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      volunteerId: volunteer3.id,
    },
  });
  console.log('✅ Created delivered donation 2');

  // ===== Create one more DELIVERED donation =====
  const deliveredDonation3 = await prisma.donation.create({
    data: {
      foodType: 'Puri Bhaji & Halwa',
      quantity: '35 servings',
      description: 'Puri, aloo bhaji, suji halwa. From breakfast service.',
      expiryTime: new Date(Date.now() - 6 * 60 * 60 * 1000),
      pickupLocation: 'The Grand Udupi Hotel, HSR Layout, Sector 2, Bangalore',
      status: 'DELIVERED',
      isUrgent: false,
      donorId: donor.id,
      claimedById: ngo.id,
    },
  });

  await prisma.pickupRequest.create({
    data: {
      donationId: deliveredDonation3.id,
      status: 'ACCEPTED',
      scheduledAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      pickedUpAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
      deliveredAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      volunteerId: volunteer.id,
    },
  });
  console.log('✅ Created delivered donation 3');

  console.log('🎉 Database seeding completed!');
  console.log('');
  console.log('📋 Summary:');
  console.log('  - 1 Admin: Nishant Ninad Deshmukh');
  console.log('  - 3 Donors: The Grand Udupi Hotel, Shawarma King, Suresh Catering');
  console.log('  - 3 NGOs (approved): Ahara Foundation, Anna Danam Trust, St. Mary\'s Food Relief');
  console.log('  - 1 Pending NGO');
  console.log('  - 3 Volunteers: Prakash Reddy, Amit Kumar Singh, Siddharth Menon');
  console.log('  - 10 Total donations with various statuses');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

