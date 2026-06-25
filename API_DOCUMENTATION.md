# API Documentation

## Base URL

```
http://localhost:3001/api
```

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

## Response Format

### Success Response
```json
{
  "data": { ... }
}
```

### Error Response
```json
{
  "error": "Error message"
}
```

## Endpoints

---

### Authentication Routes

#### POST /auth/register

Register a new user.

**Request Body:**
```json
{
  "email": "string (required, unique)",
  "password": "string (required, min 6 chars)",
  "name": "string (required)",
  "phone": "string (optional)",
  "location": "string (optional)",
  "organization": "string (optional)",
  "role": "DONOR | NGO | VOLUNTEER (required)"
}
```

**Response:**
```json
{
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "role": "DONOR",
    "isApproved": false,
    "isActive": true,
    "createdAt": "ISO8601 string"
  },
  "token": "jwt token"
}
```

---

#### POST /auth/login

Login with email and password.

**Request Body:**
```json
{
  "email": "string (required)",
  "password": "string (required)"
}
```

**Response:**
```json
{
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "role": "DONOR",
    "isApproved": true,
    "isActive": true,
    "createdAt": "ISO8601 string"
  },
  "token": "jwt token"
}
```

---

#### GET /auth/profile

Get current user profile. Requires authentication.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "string",
  "email": "string",
  "name": "string",
  "phone": "string",
  "location": "string",
  "organization": "string",
  "role": "DONOR",
  "isApproved": true,
  "isActive": true,
  "createdAt": "ISO8601 string"
}
```

---

### Donation Routes

#### GET /donations

Get all available donations. Optional filters.

**Query Parameters:**
- `status` - Filter by status (AVAILABLE, CLAIMED, PICKED_UP, DELIVERED, EXPIRED)
- `foodType` - Filter by food type
- `location` - Filter by location

**Headers:** Optional authentication

**Response:**
```json
[
  {
    "id": "string",
    "foodType": "string",
    "quantity": "string",
    "description": "string",
    "expiryTime": "ISO8601 string",
    "pickupLocation": "string",
    "imageUrl": "string",
    "status": "AVAILABLE",
    "isUrgent": false,
    "createdAt": "ISO8601 string",
    "donor": { "id": "string", "name": "string" }
  }
]
```

---

#### GET /donations/my-donations

Get donations created by current donor. Requires DONOR role.

**Headers:**
```
Authorization: Bearer <token>
```

---

#### POST /donations

Create a new donation. Requires DONOR role.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "foodType": "string (required)",
  "quantity": "string (required)",
  "description": "string (optional)",
  "expiryTime": "ISO8601 string (required)",
  "pickupLocation": "string (required)",
  "imageUrl": "string (optional)",
  "isUrgent": boolean (optional, default false)"
}
```

---

#### POST /donations/:id/claim

Claim a donation. Requires NGO role.

**Headers:**
```
Authorization: Bearer <token>
```

---

#### PUT /donations/:id/status

Update donation status. Requires ADMIN or DONOR role.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "status": "AVAILABLE | CLAIMED | PICKED_UP | DELIVERED | EXPIRED | CANCELLED"
}
```

---

### Pickup Routes

#### GET /pickups/available

Get available pickups for volunteers.

**Response:**
```json
[
  {
    "id": "string",
    "status": "PENDING",
    "scheduledAt": "ISO8601 string",
    "donation": {
      "id": "string",
      "foodType": "string",
      "quantity": "string",
      "pickupLocation": "string",
      "donor": { "id": "string", "name": "string" }
    }
  }
]
```

---

#### GET /pickups/my-pickups

Get pickups assigned to current volunteer. Requires VOLUNTEER role.

**Headers:**
```
Authorization: Bearer <token>
```

---

#### POST /pickups/:pickupRequestId/accept

Accept a pickup request. Requires VOLUNTEER role.

**Headers:**
```
Authorization: Bearer <token>
```

---

#### POST /pickups/:pickupRequestId/complete

Mark pickup as completed. Requires VOLUNTEER role.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "photoUrl": "string (optional)"
}
```

---

### User Routes (Admin)

#### GET /users

Get all users. Requires ADMIN role.

**Query Parameters:**
- `role` - Filter by role (DONOR, NGO, VOLUNTEER)
- `isApproved` - Filter by approval status (true, false)
- `search` - Search by name or email

**Headers:**
```
Authorization: Bearer <token>
```

---

#### GET /users/pending

Get users pending approval. Requires ADMIN role.

**Headers:**
```
Authorization: Bearer <token>
```

---

#### POST /users/:id/approve

Approve a user. Requires ADMIN role.

**Headers:**
```
Authorization: Bearer <token>
```

---

#### POST /users/:id/reject

Reject a user. Requires ADMIN role.

**Headers:**
```
Authorization: Bearer <token>
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid or missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource not found |
| 500 | Internal Server Error |

## Role Permissions

| Endpoint | ADMIN | DONOR | NGO | VOLUNTEER |
|----------|-------|-------|-----|-----------|
| GET /donations | ✓ | ✓ | ✓ | ✓ |
| POST /donations | - | ✓ | - | - |
| POST /donations/:id/claim | - | - | ✓ | - |
| GET /pickups/available | ✓ | - | - | ✓ |
| GET /pickups/my-pickups | - | - | - | ✓ |
| POST /pickups/:id/accept | - | - | - | ✓ |
| POST /pickups/:id/complete | - | - | - | ✓ |
| GET /users | ✓ | - | - | - |
| POST /users/:id/approve | ✓ | - | - | - |

