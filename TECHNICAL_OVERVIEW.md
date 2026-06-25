# Technical Overview

## Architecture

FoodBridge follows a client-server architecture with a RESTful API:

```
┌─────────────────┐     HTTP + JWT     ┌─────────────────┐
│   React Frontend │ ◄──────────────► │  Express Backend │
│   (Vite + TS)   │                   │   (Node.js)      │
└─────────────────┘                   └────────┬────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │  PostgreSQL     │
                                    │  (Prisma ORM)   │
                                    └─────────────────┘
```

## Frontend Architecture

### Stack
- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **React Router v6** - Client-side routing
- **TanStack Query** - Server state management
- **React Context** - Client state (Auth)

### Key Components

#### Authentication Flow
```
Login/Register → AuthContext → JWT Token → LocalStorage
                                        ↓
                              Protected Routes → Dashboard
```

#### API Integration
```
React Components → React Query Hooks → API Service → Backend
```

### Folder Structure
```
src/
├── api/                 # API service layer
│   └── index.ts        # Axios/fetch wrapper with auth
├── components/         # Reusable components
│   ├── ProtectedRoute.tsx
│   ├── DashboardLayout.tsx
│   └── ui/             # shadcn/ui components
├── context/            # React Context
│   └── AuthContext.tsx # Auth state management
├── hooks/              # Custom hooks
│   ├── useApi.ts       # React Query hooks
│   └── use-toast.ts    # Toast notifications
└── pages/              # Page components
    ├── Login.tsx
    ├── Register.tsx
    ├── AdminDashboard.tsx
    ├── DonorDashboard.tsx
    ├── NgoDashboard.tsx
    └── VolunteerDashboard.tsx
```

## Backend Architecture

### Stack
- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **TypeScript** - Type safety
- **Prisma** - ORM
- **PostgreSQL** - Database
- **JWT** - Authentication
- **bcrypt** - Password hashing

### REST API Design

#### Layered Architecture
```
Routes → Controllers → Services → Prisma → Database
    ↓
  Middleware (Auth, Validation, Error Handling)
```

#### Middleware Stack
1. **CORS** - Cross-origin requests
2. **Body Parser** - JSON parsing
3. **Auth Middleware** - JWT verification
4. **Validation Middleware** - Request validation
5. **Route Handler** - Controller
6. **Error Handler** - Exception catching

### Database Schema

#### User Model
- `id` - Unique identifier (CUID)
- `email` - Unique email
- `password` - Hashed password
- `name` - Full name
- `phone` - Contact number
- `location` - City/area
- `organization` - Organization name
- `role` - Enum (ADMIN, DONOR, NGO, VOLUNTEER)
- `isApproved` - Admin approval status
- `isActive` - Account active status

#### Donation Model
- `id` - Unique identifier
- `foodType` - Type of food
- `quantity` - Amount/servings
- `description` - Additional details
- `expiryTime` - Expiration timestamp
- `pickupLocation` - Collection address
- `status` - Enum (AVAILABLE, CLAIMED, PICKED_UP, DELIVERED, EXPIRED, CANCELLED)
- `isUrgent` - Urgent flag

#### PickupRequest Model
- `id` - Unique identifier
- `status` - Enum (PENDING, ACCEPTED, REJECTED, CANCELLED)
- `scheduledAt` - Pickup time
- `pickedUpAt` - Actual pickup time
- `deliveredAt` - Delivery time

#### Relationships
```
User (Donor) 1 ──► Many Donation
User (NGO) 1 ──► Many Donation (claimed)
User (Volunteer) 1 ──► Many PickupRequest
Donation 1 ──► 1 PickupRequest
PickupRequest 1 ──► 1 Delivery
```

## Security

### Authentication
- JWT tokens with 7-day expiration
- Passwords hashed with bcrypt (10 rounds)
- Tokens stored in localStorage

### Authorization
- Role-based access control (RBAC)
- Protected routes on frontend and backend
- Middleware validation

### API Security
- CORS configuration for allowed origins
- Input validation with express-validator
- Error handling without exposing internals

## Performance Considerations

### Frontend
- Code splitting with React.lazy
- React Query caching
- Optimistic updates

### Backend
- Prisma query optimization
- Database indexing
- Pagination for list endpoints

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:3001/api
```

## Development Workflow

1. **Backend Development**
   ```bash
   cd backend
   npm run dev          # Start dev server with hot reload
   npm run prisma:studio # Database GUI
   ```

2. **Frontend Development**
   ```bash
   npm run dev          # Start Vite dev server
   npm run build        # Production build
   ```

3. **Database**
   ```bash
   npm run prisma:migrate   # Run migrations
   npm run prisma:generate  # Generate client
   ```

## Testing

### Backend
- Manual API testing with Postman/curl
- Unit tests for services (future)

### Frontend
- Vitest for unit tests
- Playwright for E2E tests

## Deployment

### Backend
1. Set environment variables
2. Run migrations: `npm run prisma:migrate`
3. Build: `npm run build`
4. Start: `npm start`

### Frontend
1. Build: `npm run build`
2. Deploy dist folder to hosting (Vercel, Netlify, etc.)

## Future Enhancements

- Real-time notifications (WebSocket)
- Email/SMS notifications
- Google Maps integration
- Mobile apps (React Native)
- Payment integration
- Analytics dashboard improvements
- Chat functionality between users

