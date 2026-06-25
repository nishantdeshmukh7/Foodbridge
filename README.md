# FoodBridge - Food Donation Platform

A full-stack food donation platform connecting donors (restaurants, hotels, event organizers) with NGOs and volunteers to rescue surplus food and reduce food waste.

## Features

- **Role-based Dashboards**: Separate interfaces for Admin, Donor, NGO, and Volunteer
- **Real-time Donation Tracking**: Track donations from creation to delivery
- **JWT Authentication**: Secure login and registration with role-based access control
- **Donation Workflow**: Donor creates → NGO claims → Volunteer picks up → Delivery completed
- **Admin Controls**: User approvals, analytics, and platform monitoring

## Tech Stack

### Frontend
- React 18 + TypeScript
- Vite
- Tailwind CSS + shadcn/ui
- React Router v6
- TanStack Query (React Query)
- Recharts (analytics)

### Backend
- Node.js + Express
- TypeScript
- Prisma ORM
- PostgreSQL
- JWT Authentication
- bcrypt password hashing

## Project Structure

```
feed-forward-main/
├── frontend/              # React frontend (current src/)
│   ├── src/
│   │   ├── api/          # API service layer
│   │   ├── components/   # React components
│   │   ├── context/      # Auth context
│   │   ├── hooks/        # Custom hooks & React Query hooks
│   │   └── pages/        # Dashboard pages
│   └── ...
├── backend/              # Express backend
│   ├── src/
│   │   ├── config/      # Configuration
│   │   ├── controllers/ # Route controllers
│   │   ├── middleware/  # Auth & validation middleware
│   │   ├── models/      # Prisma client
│   │   ├── routes/      # API routes
│   │   └── services/    # Business logic
│   └── prisma/          # Database schema
└── ...
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment file:
   ```bash
   cp .env.example .env
   ```

4. Update `.env` with your database credentials:
   ```
   DATABASE_URL="postgresql://postgres:password@localhost:5432/foodbridge?schema=public"
   JWT_SECRET="your-secret-key"
   PORT=3001
   ```

5. Generate Prisma client and run migrations:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

6. Start the backend server:
   ```bash
   npm run dev
   ```

   The API will be available at `http://localhost:3001`

### Frontend Setup

1. Navigate to the project root:
   ```bash
   cd feed-forward-main
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root:
   ```
   VITE_API_URL=http://localhost:3001/api
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

   The frontend will be available at `http://localhost:5173`

## Default Test Accounts

After seeding the database, you can use these accounts:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@foodbridge.com | admin123 |
| Donor | donor@foodbridge.com | donor123 |
| NGO | ngo@foodbridge.com | ngo123 |
| Volunteer | volunteer@foodbridge.com | volunteer123 |

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get current user profile

### Donations
- `GET /api/donations` - List all donations
- `GET /api/donations/my-donations` - Get donor's donations
- `POST /api/donations` - Create new donation (Donor)
- `POST /api/donations/:id/claim` - Claim donation (NGO)
- `PUT /api/donations/:id/status` - Update donation status

### Pickups
- `GET /api/pickups/available` - Get available pickups
- `GET /api/pickups/my-pickups` - Get volunteer's pickups
- `POST /api/pickups/:id/accept` - Accept pickup (Volunteer)
- `POST /api/pickups/:id/complete` - Complete delivery (Volunteer)

### Users (Admin)
- `GET /api/users` - List all users
- `GET /api/users/pending` - Get pending approvals
- `POST /api/users/:id/approve` - Approve user
- `POST /api/users/:id/reject` - Reject user

## Donation Workflow

1. **Donor** creates a food listing with quantity, pickup location, and expiry time
2. **NGO** claims the available donation
3. **Admin** assigns a volunteer to the pickup request
4. **Volunteer** accepts and completes the pickup
5. **Volunteer** marks delivery as completed
6. Donation status updates to "DELIVERED"

## Scripts

### Backend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run prisma:studio` - Open Prisma Studio
- `npm run prisma:migrate` - Run database migrations

### Frontend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint

## License

MIT

