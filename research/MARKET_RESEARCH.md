# Market research: study-seat reservation competitors

This document summarizes existing tools/products similar to our ETH study-seat reservation idea:

- ETH university identity (Switch edu-ID)
- pre-reservation of seats/desks
- QR-based check-in at desk
- anti-hogging/fair-use limits
- profile-based filtering (for example by ETH profile/attributes)

## Short answer

There are tools that overlap strongly with our scope, but no clear off-the-shelf option was found that matches all ETH-specific requirements (especially QR desk check-in + ETH profile-driven filtering + policy enforcement as one coherent product).

## Competitor landscape

### 1) Seatsurfing (strongest near-fit)

**What it already has**

- Open-source + hosted offering for desk/room booking:  
  <https://github.com/seatsurfing/seatsurfing/blob/main/README.md>
- OAuth/OIDC identity provider support (good basis for Switch edu-ID via OIDC):  
  <https://github.com/seatsurfing/seatsurfing/blob/main/specs/openapi.yaml>
- Booking limits and anti-hogging controls (max bookings, concurrent booking limits, advance window checks):  
  <https://github.com/seatsurfing/seatsurfing/blob/main/server/api/entities.go>  
  <https://github.com/seatsurfing/seatsurfing/blob/main/server/service/booking-service.go>
- Attribute/group-style controls and filtering hooks around bookers/spaces:  
  <https://github.com/seatsurfing/seatsurfing/blob/main/server/api/hostapi_booking.go>  
  <https://github.com/seatsurfing/seatsurfing/blob/main/server/app/test/hostapi-booking_test.go>

**Gap against our target**

- No clear evidence in core docs/code of first-class QR desk occupancy check-in workflow.

**Verdict**

- Serious competitor and the best build-vs-buy baseline.

### 2) phpScheduleIt / Booked family (partial fit, legacy)

**What it has**

- SAML mention, quotas, pre-reservation plugin mention in docs/changelog:  
  <https://github.com/alexandrezia/phpscheduleit/blob/master/readme.html>
- LDAP authentication plugin:  
  <https://github.com/alexandrezia/phpscheduleit/blob/master/plugins/Authentication/Ldap/Ldap.php>

**Gap against our target**

- Legacy architecture and no strong evidence of modern QR desk check-in + ETH-specific filtering flow.

**Verdict**

- Could reduce initial effort, but likely high integration/modernization cost.

### 3) OpenOLAT (Swiss ecosystem relevance, not direct seat-booking replacement)

**What is relevant**

- Explicit Switch edu-ID references in OAuth login module:  
  <https://github.com/OpenOLAT/OpenOLAT/blob/main/src/main/java/org/olat/login/oauth/OAuthLoginModule.java>
- Room management APIs documented in architecture notes:  
  <https://github.com/OpenOLAT/OpenOLAT/blob/main/doc/openolat-architecture.md>

**Gap against our target**

- OpenOLAT is an LMS platform; not a dedicated desk-seat reservation/check-in product.

**Verdict**

- Platform extension path, not direct replacement.

### 4) Student/demo projects (feature inspiration, not procurement alternatives)

- Study-room-booking demo with timeout/blacklist concepts:  
  <https://github.com/cai-creator/study-room-booking/blob/main/README.md>
- LibraryPlus demo claiming seat booking + QR check-in:  
  <https://github.com/chamodhlv/IT3060-Y3.S2.WE_24-library-book-seat-booking-app/blob/main/README.md>

These are useful references for ideas, but not serious enterprise alternatives.

## Why our approach is different

Our planned ETH-focused solution differentiates through:

1. **ETH-native identity and eligibility**: Switch edu-ID + ETH profile attributes integrated into booking and filtering logic.
2. **Policy-first anti-hogging enforcement**: practical no-show penalties, booking caps, and fairness rules aligned with university operations.
3. **Desk-level QR check-in enforcement**: booking only becomes active when user scans at the correct desk in time.
4. **ETH context filtering**: filtering and ranking of seats/desks by profile-relevant criteria (quiet zones, equipment, accessibility, etc.).
5. **Operational fit for campus governance**: explicit handling of authority and rule enforcement expected in university-managed spaces.

## “Should we build this ourselves?”

- **If we want fastest rollout with compromises**: evaluate Seatsurfing first, then estimate customization needed for QR desk check-in and ETH-specific profile/authority rules.
- **If ETH-specific behavior is core (likely)**: building (or heavily extending) remains justified, because those requirements are the differentiator and not clearly available as a complete package.
