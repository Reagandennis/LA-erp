import 'server-only';

import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
} from 'docx';
import type { NextRequest } from 'next/server';

import { recordAuditEvent } from './audit';
import { getGeminiApiKey, getGeminiModel } from './env';
import { prisma } from './prisma';
import { enforceRateLimit } from './rate-limit';

const DEFAULT_TEMPLATE_SLUG = 'geosecure-venue-advance-v1';
const PROMPT_VERSION = 'trip-intel-v1';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

type IntelDbClient = typeof prisma | Prisma.TransactionClient;

type TripWithItinerary = Prisma.TripGetPayload<{
  include: {
    itineraryItems: {
      orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }];
    };
  };
}>;

type TemplateSection = {
  id: number;
  templateId: number;
  key: string;
  label: string;
  description: string | null;
  promptHint: string | null;
  sourceType: string;
  isEnabled: boolean;
  isRequired: boolean;
  sortOrder: number;
  config: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

type TemplateWithSections = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  isDefault: boolean;
  config: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  sections: TemplateSection[];
};

type JsonObject = Record<string, Prisma.JsonValue>;

type TripIntelReportWithSections = Prisma.TripIntelReportGetPayload<{
  include: {
    sections: true;
    template: {
      include: { sections: true };
    };
  };
}>;

type ExportFieldDefinition = {
  key: string;
  label: string;
};

type ExportSectionDefinition = {
  reportKey: string;
  title: string;
  objective: string;
  guidance: string[];
  fields: ExportFieldDefinition[];
};

const DEFAULT_TEMPLATE_SECTIONS = [
  {
    key: 'metadata',
    label: 'Metadata',
    description: 'System metadata, approvals, and AI audit traces.',
    promptHint: 'Summarize system metadata and highlight missing reviewer approvals without inventing names.',
    sourceType: 'system',
    isRequired: true,
    sortOrder: 1,
    config: {
      fields: ['dateCreated', 'dateUpdated', 'dateReviewed', 'approvedBy', 'aiUsageAudit'],
    },
  },
  {
    key: 'general_information',
    label: 'General Information',
    description: 'Venue/site overview, category, descriptive narrative, and hospitality facts.',
    promptHint: 'Create a concise executive-style venue/site overview from the trip destination and known logistics, and clearly mark assumptions and missing venue facts.',
    sourceType: 'mixed',
    isRequired: true,
    sortOrder: 2,
    config: {
      fields: [
        'venueName',
        'categoryType',
        'venueDescription',
        'verbalPicture',
        'roomsCount',
        'costEstimatePerNight',
        'restaurantOrCafe',
        'mapOrLayout',
      ],
    },
  },
  {
    key: 'location_and_access',
    label: 'Location and Access',
    description: 'Coordinates, maps, address, geofence, and route relationships to key locations.',
    promptHint: 'List location and route requirements using only provided trip facts and obvious placeholders for venue confirmation.',
    sourceType: 'mixed',
    isRequired: true,
    sortOrder: 3,
    config: {
      fields: [
        'gpsCoordinates',
        'googleMapsLink',
        'pinPlacement',
        'physicalAddress',
        'routesToOfficeHospitalPoliceAirport',
        'geofence',
      ],
    },
  },
  {
    key: 'contacts',
    label: 'Contact Information',
    description: 'Venue general, management, and security points of contact.',
    promptHint: 'Provide a contact checklist and identify which fields require user-entered verification.',
    sourceType: 'mixed',
    isRequired: true,
    sortOrder: 4,
    config: {
      fields: [
        'generalContact',
        'generalManagerOrOwner',
        'securityContact',
        'emailAddress',
        'phoneNumber',
        'socialMediaLinks',
      ],
    },
  },
  {
    key: 'site_specific_information',
    label: 'Site Specific Information',
    description: 'User-input venue specifics, room details, safe havens, and arrival instructions.',
    promptHint: 'Create a checklist for site-specific venue advance notes and room-level details that an operator still needs to verify.',
    sourceType: 'user_input',
    isRequired: true,
    sortOrder: 5,
    config: {
      fields: [
        'meetingLocation',
        'roomNumber',
        'photosWithDescription',
        'securityDetails',
        'nearestSafeRoom',
        'evacuationProcedures',
        'vehicleEntryExit',
      ],
    },
  },
  {
    key: 'routes_and_parking',
    label: 'Routes and Parking',
    description: 'Standard routes, parking, drop points, and access timing.',
    promptHint: 'Outline route and parking placeholders for hospital, police, airport, and venue arrival/egress planning.',
    sourceType: 'mixed',
    isRequired: true,
    sortOrder: 6,
    config: {
      fields: [
        'standardRoutes',
        'parkingDetails',
        'dropPoint',
        'parkingCosts',
        'paymentMethods',
      ],
    },
  },
  {
    key: 'security_and_emergency',
    label: 'Security and Emergency',
    description: 'Venue security procedures, emergency plans, and response capabilities.',
    promptHint: 'Draft a practical baseline security and emergency checklist with conservative assumptions, highlighting all fields requiring human validation.',
    sourceType: 'mixed',
    isRequired: true,
    sortOrder: 7,
    config: {
      fields: [
        'securityProcedures',
        'securityPointOfContact',
        'securityCompany',
        'responseCapabilities',
        'vipBypassSecurity',
        'fireProcedure',
        'medicalProcedure',
        'securityProcedure',
      ],
    },
  },
  {
    key: 'medical_support',
    label: 'Medical Support',
    description: 'Nearby hospital/clinic support and linkage to venue advance packets.',
    promptHint: 'List hospital support requirements, emphasizing route-based proximity, hospital level, and missing local medical data.',
    sourceType: 'mixed',
    isRequired: true,
    sortOrder: 8,
    config: {
      fields: ['linkedHospitals', 'hospitalLevel', 'hospitalContacts', 'coverageGap'],
    },
  },
  {
    key: 'risk_assessment',
    label: 'Venue Security Risk Assessment',
    description: 'Baseline risk rating, nearby incidents, protest/crime context, and analyst notes.',
    promptHint: 'Give a simple low/medium/high baseline risk assessment based only on available trip context and clearly list missing intelligence inputs.',
    sourceType: 'ai',
    isRequired: true,
    sortOrder: 9,
    config: {
      fields: ['riskRating', 'crimeOrProtestSignals', 'analystNotes'],
    },
  },
  {
    key: 'data_sources',
    label: 'Data Sources',
    description: 'Source references used to build the report.',
    promptHint: 'List authoritative data sources and clearly separate actual sources used from recommended sources still to be checked.',
    sourceType: 'ai',
    isRequired: true,
    sortOrder: 10,
    config: {
      fields: ['acled', 'localOpenSourceData', 'internalDatabase', 'other'],
    },
  },
] as const;

const EXPORT_SECTION_DEFINITIONS: ExportSectionDefinition[] = [
  {
    reportKey: 'metadata',
    title: 'Metadata',
    objective: 'Track report lifecycle, approval status, and AI audit context for this venue advance.',
    guidance: [
      'Record date created, date updated, and date reviewed/approved.',
      'Identify the approving authority and preserve AI usage notes for audit review.',
    ],
    fields: [
      { key: 'dateCreated', label: 'Date Created' },
      { key: 'dateUpdated', label: 'Date Updated' },
      { key: 'dateReviewed', label: 'Date Reviewed / Approved' },
      { key: 'approvedBy', label: 'Approved By' },
      { key: 'aiUsageAudit', label: 'AI Usage Audit' },
    ],
  },
  {
    reportKey: 'general_information',
    title: 'General Information',
    objective: 'Capture the core identity of the venue and paint a practical verbal picture for first-time visitors.',
    guidance: [
      'Confirm the most common venue name and whether the site has alternate or multi-use names.',
      'Document category type, venue description, verbal picture, hotel room count, cost estimate, and on-site amenities.',
      'Collect front-view and common-area photos and any verified map/layout references when available.',
    ],
    fields: [
      { key: 'venueName', label: 'Venue Name' },
      { key: 'categoryType', label: 'Category Type' },
      { key: 'venueDescription', label: 'Venue Description' },
      { key: 'verbalPicture', label: 'Verbal Picture' },
      { key: 'roomsCount', label: 'Number of Rooms' },
      { key: 'costEstimatePerNight', label: 'Cost Estimate Per Night' },
      { key: 'restaurantOrCafe', label: 'Restaurant / Cafe On Site' },
      { key: 'mapOrLayout', label: 'Map or Layout' },
    ],
  },
  {
    reportKey: 'location_and_access',
    title: 'Location of the Venue',
    objective: 'Define how to locate the venue, confirm its geospatial accuracy, and tie it to key operating locations.',
    guidance: [
      'Capture GPS coordinates, Google Maps link, physical address, and any pin adjustment notes.',
      'Document route relationships to office, hospital, police station, and airport.',
      'Maintain a venue geofence that is tight enough to reduce drive-by false positives.',
    ],
    fields: [
      { key: 'gpsCoordinates', label: 'GPS Coordinates' },
      { key: 'googleMapsLink', label: 'Google Maps Link' },
      { key: 'pinPlacement', label: 'Pin Placement Notes' },
      { key: 'physicalAddress', label: 'Physical Address' },
      { key: 'routesToOfficeHospitalPoliceAirport', label: 'Routes to Key Locations' },
      { key: 'geofence', label: 'Geofence' },
    ],
  },
  {
    reportKey: 'contacts',
    title: 'Contact Information - Point of Contact',
    objective: 'Capture searchable venue, management, and security contacts that can later be synchronized with contact systems.',
    guidance: [
      'Track the venue general contact, the general manager or owner, and the venue security point of contact separately.',
      'Collect phone numbers, email addresses, and social media references where relevant.',
    ],
    fields: [
      { key: 'generalContact', label: 'General Venue Contact' },
      { key: 'generalManagerOrOwner', label: 'General Manager / Owner' },
      { key: 'securityContact', label: 'Security Contact' },
      { key: 'emailAddress', label: 'Email Address' },
      { key: 'phoneNumber', label: 'Phone Number' },
      { key: 'socialMediaLinks', label: 'Social Media Links' },
    ],
  },
  {
    reportKey: 'site_specific_information',
    title: 'Site Specific Information',
    objective: 'Describe exact room-level access, safe haven details, and user-verified operational notes for the venue.',
    guidance: [
      'Document exact meeting room or venue location, room number, and a walkthrough of arrival from the entrance.',
      'Capture photos with descriptions, nearest safe room or haven, emergency evacuation details, and vehicle entry/exit control notes.',
    ],
    fields: [
      { key: 'meetingLocation', label: 'Meeting Location' },
      { key: 'roomNumber', label: 'Room Number' },
      { key: 'photosWithDescription', label: 'Photos with Description' },
      { key: 'securityDetails', label: 'Security Details' },
      { key: 'nearestSafeRoom', label: 'Nearest Safe Room / Haven' },
      { key: 'evacuationProcedures', label: 'Emergency Evacuation Procedures' },
      { key: 'vehicleEntryExit', label: 'Vehicle Entry / Exit' },
    ],
  },
  {
    reportKey: 'routes_and_parking',
    title: 'Standard Routes and Parking',
    objective: 'Track route timing, drop points, and parking logistics for operational arrivals and emergency movement.',
    guidance: [
      'Document standard routes with estimated times to hospital, police station, and airport.',
      'Capture primary drop point, parking type, photos, costs, and payment methods.',
    ],
    fields: [
      { key: 'standardRoutes', label: 'Standard Routes / Estimated Time' },
      { key: 'dropPoint', label: 'Drop Point / Primary Entrance' },
      { key: 'parkingDetails', label: 'Parking Details' },
      { key: 'parkingCosts', label: 'Parking Costs' },
      { key: 'paymentMethods', label: 'Payment Methods' },
    ],
  },
  {
    reportKey: 'security_and_emergency',
    title: 'Security Procedures',
    objective: 'Document venue security procedures, emergency response capability, and escalation contacts.',
    guidance: [
      'Describe venue screening, guard force, security point of contact, security company, and any VIP bypass procedures.',
      'Capture fire, medical, and security emergency procedures plus nearest MRU or police response capability.',
    ],
    fields: [
      { key: 'securityProcedures', label: 'Security Procedures' },
      { key: 'securityPointOfContact', label: 'Security Point of Contact' },
      { key: 'securityCompany', label: 'Security Company' },
      { key: 'responseCapabilities', label: 'Response Capabilities / MRU / Police' },
      { key: 'vipBypassSecurity', label: 'VIP Bypass / Security Requests' },
      { key: 'fireProcedure', label: 'Fire Procedure' },
      { key: 'medicalProcedure', label: 'Medical Procedure' },
      { key: 'securityProcedure', label: 'Security Emergency Procedure' },
    ],
  },
  {
    reportKey: 'medical_support',
    title: 'Hospitals',
    objective: 'Link the venue to appropriate hospitals by route distance and preserve medical support context.',
    guidance: [
      'Each hospital should ultimately exist as its own venue packet and be tagged to other venues in the same city.',
      'If no suitable hospital exists within policy distance, prompt creation of a new hospital venue record.',
      'Use route distance rather than line-of-sight when identifying hospitals.',
    ],
    fields: [
      { key: 'linkedHospitals', label: 'Linked Hospitals' },
      { key: 'hospitalLevel', label: 'Hospital / Clinic Level' },
      { key: 'hospitalContacts', label: 'Hospital Contact Information' },
      { key: 'coverageGap', label: 'Coverage Gap / Creation Prompt' },
    ],
  },
  {
    reportKey: 'risk_assessment',
    title: 'Venue Security Risk Assessment',
    objective: 'Provide a concise operational risk summary with supporting incident or analyst observations.',
    guidance: [
      'Keep the risk rating conservative and clearly flag where venue-specific intelligence is still missing.',
      'Summarize nearby crime, protest, and security signals affecting advance planning.',
    ],
    fields: [
      { key: 'riskRating', label: 'Risk Rating' },
      { key: 'crimeOrProtestSignals', label: 'Crime / Protest Signals' },
      { key: 'analystNotes', label: 'Analyst Notes' },
    ],
  },
  {
    reportKey: 'data_sources',
    title: 'Data Sources',
    objective: 'Preserve what sources informed the packet and what additional sources should still be checked.',
    guidance: [
      'Separate sources already used from recommended sources still requiring review.',
      'Preserve any AI-supporting source notes for auditability.',
    ],
    fields: [
      { key: 'acled', label: 'ACLED' },
      { key: 'localOpenSourceData', label: 'Local Open Source Data' },
      { key: 'internalDatabase', label: 'Internal Database' },
      { key: 'other', label: 'Other Sources' },
    ],
  },
];

function normalizeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function buildTripSourceSnapshot(trip: TripWithItinerary): JsonObject {
  const itinerary = trip.itineraryItems.map((item) => ({
    dayNumber: item.dayNumber,
    title: item.title,
    type: item.itemType,
    location: item.location,
    startLocation: item.startLocation,
    endLocation: item.endLocation,
    startTime: normalizeDate(item.startTime),
    endTime: normalizeDate(item.endTime),
    notes: item.notes,
  }));

  return {
    tripId: trip.id,
    title: trip.title,
    destination: trip.destination ?? '',
    status: trip.status,
    startDate: normalizeDate(trip.startDate),
    endDate: normalizeDate(trip.endDate),
    itineraryCount: itinerary.length,
    itinerary,
  };
}

function buildSourceHash(snapshot: JsonObject) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Pending confirmation';
  }

  if (Array.isArray(value)) {
    const values = value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
      .filter(Boolean);

    return values.length > 0 ? values.join(', ') : 'Pending confirmation';
  }

  if (typeof value === 'object') {
    const entries = Object.entries(asRecord(value))
      .filter(([, item]) => item !== null && item !== undefined && item !== '')
      .map(([key, item]) => `${key}: ${String(item)}`);

    return entries.length > 0 ? entries.join('; ') : 'Pending confirmation';
  }

  return String(value);
}

function formatTravelWindow(startDate: Date | null, endDate: Date | null) {
  if (!startDate && !endDate) {
    return 'Dates pending';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (startDate && endDate) {
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  }

  return startDate ? formatter.format(startDate) : formatter.format(endDate as Date);
}

function slugifyFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function getReportSection(report: TripIntelReportWithSections, reportKey: string) {
  const section = report.sections.find((item) => item.key === reportKey);
  const content = asRecord(section?.content);

  return {
    section,
    content,
    fields: asRecord(content.fields),
    details: asStringArray(content.details),
    requiredInputs: asStringArray(content.requiredInputs),
    sourcesUsed: asStringArray(content.sourcesUsed),
    sourcesRecommended: asStringArray(content.sourcesRecommended),
    summary: typeof content.summary === 'string' ? content.summary : null,
  };
}

function createTextParagraph(text: string, options?: { bold?: boolean; italic?: boolean; spacingAfter?: number }) {
  return new Paragraph({
    spacing: { after: options?.spacingAfter ?? 120 },
    children: [new TextRun({ text, bold: options?.bold, italics: options?.italic })],
  });
}

function createBulletParagraph(text: string) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}

function createTableCell(text: string, options?: { header?: boolean }) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: options?.header ?? false })],
      }),
    ],
    shading: options?.header ? { fill: 'E2E8F0' } : undefined,
    margins: {
      top: 100,
      bottom: 100,
      left: 120,
      right: 120,
    },
  });
}

function createFieldTable(fields: Array<{ label: string; value: string }>) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    },
    rows: [
      new TableRow({
        children: [createTableCell('Field', { header: true }), createTableCell('Current Value', { header: true })],
      }),
      ...fields.map((field) => new TableRow({
        children: [createTableCell(field.label), createTableCell(field.value)],
      })),
    ],
  });
}

function buildExportChildren(report: TripIntelReportWithSections, trip: TripWithItinerary): FileChild[] {
  const overviewChildren: FileChild[] = [
    new Paragraph({
      text: `${trip.title} - Venue Advance Report`,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: report.title, bold: true, size: 30 }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    createTextParagraph(`Trip: ${trip.title}`, { bold: true }),
    createTextParagraph(`Destination: ${trip.destination || 'Pending'}`),
    createTextParagraph(`Travel Window: ${formatTravelWindow(trip.startDate, trip.endDate)}`),
    createTextParagraph(`Overall Risk Level: ${report.overallRiskLevel ?? 'Pending Review'}`),
    createTextParagraph(`Generation Status: ${report.generationStatus}`),
    new Paragraph({ text: '', spacing: { after: 120 } }),
  ];

  const sectionChildren = EXPORT_SECTION_DEFINITIONS.flatMap((definition) => {
    const sectionData = getReportSection(report, definition.reportKey);
    const tableFields = definition.fields.map((field) => ({
      label: field.label,
      value: toDisplayValue(sectionData.fields[field.key]),
    }));
    
    const children: FileChild[] = [
      new Paragraph({ text: definition.title, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } }),
      ...(sectionData.summary ? [createTextParagraph(sectionData.summary)] : []),
      createFieldTable(tableFields),
    ];

    if (sectionData.details.length > 0) {
      children.push(new Paragraph({ text: 'Operational Notes', heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 80 } }));
      children.push(...sectionData.details.map((item) => createBulletParagraph(item)));
    }

    if (sectionData.requiredInputs.length > 0) {
      children.push(new Paragraph({ text: 'Required Inputs', heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 80 } }));
      children.push(...sectionData.requiredInputs.map((item) => createBulletParagraph(item)));
    }

    if (sectionData.sourcesUsed.length > 0) {
      children.push(new Paragraph({ text: 'Sources Used', heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 80 } }));
      children.push(...sectionData.sourcesUsed.map((item) => createBulletParagraph(item)));
    }

    if (sectionData.sourcesRecommended.length > 0) {
      children.push(new Paragraph({ text: 'Recommended Sources', heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 80 } }));
      children.push(...sectionData.sourcesRecommended.map((item) => createBulletParagraph(item)));
    }

    return children;
  });

  if (trip.itineraryItems.length > 0) {
    sectionChildren.push(
      new Paragraph({ text: 'Trip Itinerary Snapshot', heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } }),
      ...trip.itineraryItems.map((item) => createBulletParagraph(
        `Day ${item.dayNumber}: ${item.title}${item.location ? ` — ${item.location}` : ''}`
      ))
    );
  }

  return [...overviewChildren, ...sectionChildren];
}

function buildFallbackSectionContent(section: TemplateSection, snapshot: JsonObject): JsonObject {
  const title = String(snapshot.title ?? 'Untitled trip');
  const destination = String(snapshot.destination ?? 'Destination pending confirmation');
  const startDate = snapshot.startDate ? String(snapshot.startDate) : 'TBD';
  const endDate = snapshot.endDate ? String(snapshot.endDate) : 'TBD';

  switch (section.key) {
    case 'metadata':
      return {
        summary: 'System-generated baseline metadata for this trip intelligence report.',
        fields: {
          dateCreated: new Date().toISOString(),
          dateUpdated: new Date().toISOString(),
          dateReviewed: null,
          approvedBy: null,
          aiUsageAudit: 'Initial draft created automatically on trip creation. AI enrichment runs only when server-side Gemini credentials and rate budget are available.',
        },
      };
    case 'general_information':
      return {
        summary: `${title} is an active trip draft for ${destination}. Venue-specific facts still need to be confirmed before operational use.`,
        details: [
          `Trip window: ${startDate} to ${endDate}.`,
          'Venue name, category type, and descriptive site narrative are pending confirmation.',
          'Hospitality details such as room count, pricing, and restaurant availability should be captured once a venue is selected.',
        ],
        requiredInputs: ['venue name', 'category type', 'venue description', 'layout or map', 'photo set'],
      };
    case 'location_and_access':
      return {
        summary: 'Location baseline created from trip destination only; precise venue coordinates are not yet confirmed.',
        details: [
          `Destination reference: ${destination}.`,
          'GPS coordinates, Google Maps link, physical address, and geofence must be confirmed against the selected venue.',
          'Routes to office, hospital, police station, and airport should be generated after venue selection.',
        ],
        requiredInputs: ['GPS coordinates', 'Google Maps link', 'physical address', 'geofence polygon'],
      };
    case 'contacts':
      return {
        summary: 'All venue contacts require user validation or direct entry.',
        details: [
          'Capture general venue contact details in searchable form.',
          'Add management and security points of contact separately for future Google Contacts sync.',
        ],
        requiredInputs: ['general email', 'general phone', 'manager name', 'manager phone', 'security phone'],
      };
    case 'site_specific_information':
      return {
        summary: 'This section remains user-input only and should be completed after an advance visit or trusted confirmation.',
        details: [
          'Describe meeting room access, exact room number, and what a first-time visitor will encounter on arrival.',
          'Capture safe room locations, vehicle entry/exit controls, and photo notes.',
        ],
        requiredInputs: ['meeting location', 'safe haven', 'evacuation notes', 'vehicle access notes', 'annotated photos'],
      };
    case 'routes_and_parking':
      return {
        summary: 'Route and parking planning placeholders are ready for venue-specific confirmation.',
        details: [
          'Add standard routes with estimated travel times to hospital, police station, and airport.',
          'Document drop-off point, parking surface type, payment methods, and parking fees if applicable.',
        ],
        requiredInputs: ['route timings', 'drop point', 'parking type', 'parking cost', 'payment method'],
      };
    case 'security_and_emergency':
      return {
        summary: 'Baseline security checklist created; no venue-specific controls have been verified yet.',
        details: [
          'Confirm access control, screening, guard force, response capabilities, and any VIP bypass procedures.',
          'Attach fire, medical, and security incident procedures once the venue is selected.',
        ],
        requiredInputs: ['security procedures', 'security company', 'response capability', 'fire plan', 'medical plan'],
      };
    case 'medical_support':
      return {
        summary: 'Hospital linkage is pending. The system should associate route-based hospitals once venue geography is known.',
        details: [
          'Link the nearest suitable hospital by actual route distance, not line-of-sight.',
          'If no hospital exists within policy range, create a new hospital venue record.',
        ],
        requiredInputs: ['hospital name', 'hospital level', 'route distance', 'medical contact information'],
      };
    case 'risk_assessment':
      return {
        summary: 'Initial automated risk baseline is not yet venue-specific.',
        details: [
          `Trip context currently points to ${destination}.`,
          'Crime, protest, and incident signals should be refreshed from ACLED and local open-source reporting once the venue is selected.',
        ],
        riskRating: 'Pending Review',
        requiredInputs: ['open source checks', 'recent incident review', 'local analyst note'],
      };
    case 'data_sources':
      return {
        summary: 'Recommended source set prepared for later enrichment.',
        sourcesUsed: ['Trip title', 'Destination', 'Trip dates', 'Trip itinerary metadata'],
        sourcesRecommended: ['ACLED', 'Local open-source media', 'X / Facebook signals', 'Internal incident database'],
      };
    default:
      return {
        summary: `${section.label} draft created automatically.`,
        details: ['Additional structured input is still required.'],
      };
  }
}

function mergeAiContent(fallbackContent: JsonObject, aiContent: JsonObject | null | undefined): JsonObject {
  if (!aiContent) {
    return fallbackContent;
  }

  return {
    ...fallbackContent,
    ...aiContent,
    aiAugmented: true,
  };
}

async function ensureDefaultTemplate(db: IntelDbClient): Promise<TemplateWithSections> {
  const existing = await db.intelReportTemplate.findUnique({
    where: { slug: DEFAULT_TEMPLATE_SLUG },
    include: { sections: { orderBy: { sortOrder: 'asc' } } },
  });

  if (existing) {
    return existing;
  }

  return db.intelReportTemplate.create({
    data: {
      slug: DEFAULT_TEMPLATE_SLUG,
      name: 'GeoSecure Venue Advance Intel Template',
      description: 'Baseline site advance template for trip-linked intelligence reporting.',
      version: 1,
      isDefault: true,
      config: {
        autoGenerateOnTripCreate: true,
        promptVersion: PROMPT_VERSION,
      },
      sections: {
        create: DEFAULT_TEMPLATE_SECTIONS.map((section) => ({
          key: section.key,
          label: section.label,
          description: section.description,
          promptHint: section.promptHint,
          sourceType: section.sourceType,
          isRequired: section.isRequired,
          sortOrder: section.sortOrder,
          config: section.config,
        })),
      },
    },
    include: { sections: { orderBy: { sortOrder: 'asc' } } },
  });
}

function buildAiPrompt(snapshot: JsonObject, sections: TemplateSection[]) {
  return [
    'You are generating a concise, conservative trip intelligence draft.',
    'Only use the provided trip facts. Do not invent exact venue names, contacts, coordinates, or security facts.',
    'Where facts are missing, clearly mark them as missing or user-required.',
    'Return valid JSON with this shape:',
    '{"sections":[{"key":"section_key","summary":"...","details":["..."],"requiredInputs":["..."],"fields":{"fieldName":"fieldValue"},"riskRating":"Low|Medium|High|Pending Review","sourcesUsed":["..."],"sourcesRecommended":["..."]}]}',
    'Only include the requested sections below.',
    `Trip snapshot: ${JSON.stringify(snapshot)}`,
    `Requested sections: ${JSON.stringify(sections.map((section) => {
      const def = EXPORT_SECTION_DEFINITIONS.find(d => d.reportKey === section.key);
      return {
        key: section.key,
        label: section.label,
        objective: def?.objective,
        guidance: def?.guidance,
        promptHint: section.promptHint,
        fieldsToPopulate: def?.fields.map(f => f.key)
      };
    }))}`,
  ].join('\n');
}

function extractTextFromGeminiResponse(payload: unknown): string | null {
  const candidates =
    typeof payload === 'object' && payload !== null && 'candidates' in payload
      ? (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
      : undefined;

  if (!Array.isArray(candidates)) {
    return null;
  }

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return null;
}

function parseGeminiJsonSafely(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const direct = () => JSON.parse(withoutFence) as {
    sections?: Array<{
      key?: string;
      summary?: string;
      details?: string[];
      riskRating?: string;
      sourcesUsed?: string[];
      sourcesRecommended?: string[];
    }>;
  };

  try {
    return direct();
  } catch {
    // Try extracting the first JSON object if the model added extra text.
  }

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = withoutFence.slice(start, end + 1);
    try {
      return JSON.parse(sliced) as {
        sections?: Array<{
          key?: string;
          summary?: string;
          details?: string[];
          riskRating?: string;
          sourcesUsed?: string[];
          sourcesRecommended?: string[];
        }>;
      };
    } catch {
      return null;
    }
  }

  return null;
}

async function generateAiSectionDrafts(
  snapshot: JsonObject,
  sections: TemplateSection[],
  actorUserId: number,
) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return {
      usedAi: false,
      reason: 'missing_api_key',
      model: null,
      drafts: new Map<string, JsonObject>(),
      usage: { promptVersion: PROMPT_VERSION },
    };
  }

  const limit = await enforceRateLimit({
    scope: 'trip-intel-report-generation',
    key: String(actorUserId),
    limit: 12,
    windowMs: 60 * 60 * 1000,
  });

  if (!limit.allowed) {
    return {
      usedAi: false,
      reason: 'rate_limited',
      model: getGeminiModel(),
      drafts: new Map<string, JsonObject>(),
      usage: {
        promptVersion: PROMPT_VERSION,
        retryAfterSeconds: limit.retryAfterSeconds,
      },
    };
  }

  const model = getGeminiModel();
  const prompt = buildAiPrompt(snapshot, sections);

  try {
    const response = await fetch(`${GEMINI_API_URL}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 1400,
        },
      }),
    });

    if (!response.ok) {
      return {
        usedAi: false,
        reason: `gemini_http_${response.status}`,
        model,
        drafts: new Map<string, JsonObject>(),
        usage: {
          promptVersion: PROMPT_VERSION,
          httpStatus: response.status,
        },
      };
    }

    const payload = await response.json();
    const text = extractTextFromGeminiResponse(payload);

    if (!text) {
      return {
        usedAi: false,
        reason: 'empty_ai_response',
        model,
        drafts: new Map<string, JsonObject>(),
        usage: { promptVersion: PROMPT_VERSION },
      };
    }

    const parsed = parseGeminiJsonSafely(text);
    if (!parsed) {
      return {
        usedAi: false,
        reason: 'invalid_ai_json',
        model,
        drafts: new Map<string, JsonObject>(),
        usage: { promptVersion: PROMPT_VERSION },
      };
    }

    const drafts = new Map<string, JsonObject>();

    for (const section of parsed.sections ?? []) {
      if (!section.key) {
        continue;
      }

      drafts.set(section.key, {
        summary: section.summary ?? 'AI draft generated.',
        details: Array.isArray(section.details) ? section.details : [],
        riskRating: section.riskRating ?? null,
        sourcesUsed: Array.isArray(section.sourcesUsed) ? section.sourcesUsed : [],
        sourcesRecommended: Array.isArray(section.sourcesRecommended)
          ? section.sourcesRecommended
          : [],
      });
    }

    return {
      usedAi: drafts.size > 0,
      reason: drafts.size > 0 ? 'ai_generated' : 'no_matching_sections',
      model,
      drafts,
      usage: {
        promptVersion: PROMPT_VERSION,
        remaining: limit.remaining,
      },
    };
  } catch (error) {
    console.error('Trip intel AI generation failed', error);

    return {
      usedAi: false,
      reason: 'ai_request_failed',
      model,
      drafts: new Map<string, JsonObject>(),
      usage: { promptVersion: PROMPT_VERSION },
    };
  }
}

export async function ensureTripIntelReportForTrip(options: {
  tripId: number;
  actorUserId: number;
  request?: NextRequest;
}) {
  const existing = await prisma.tripIntelReport.findFirst({
    where: { tripId: options.tripId },
    include: {
      sections: { orderBy: { sortOrder: 'asc' } },
      template: {
        include: { sections: { orderBy: { sortOrder: 'asc' } } },
      },
    },
    orderBy: { version: 'desc' },
  });

  if (existing) {
    return existing;
  }

  const trip = await prisma.trip.findUnique({
    where: { id: options.tripId },
    include: {
      itineraryItems: {
        orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!trip) {
    throw new Error('Trip not found for Intel Report creation');
  }

  const snapshot = buildTripSourceSnapshot(trip);
  const sourceHash = buildSourceHash(snapshot);
  const template = await ensureDefaultTemplate(prisma);
  const aiEligibleSections = template.sections.filter((section: TemplateSection) =>
    section.sourceType === 'ai' || section.sourceType === 'mixed',
  );
  const aiResult = await generateAiSectionDrafts(snapshot, aiEligibleSections, options.actorUserId);
  const now = new Date();

  const report = await prisma.tripIntelReport.create({
    data: {
      tripId: trip.id,
      templateId: template.id,
      version: 1,
      title: `${trip.title} Intel Report`,
      status: 'draft',
      generationStatus: aiResult.usedAi ? 'ai_enriched' : 'fallback_ready',
      overallRiskLevel: (aiResult.drafts.get('risk_assessment')?.riskRating as string | undefined) ?? 'Pending Review',
      generatedAt: now,
      aiModel: aiResult.model,
      aiPromptVersion: PROMPT_VERSION,
      aiSourceHash: sourceHash,
      aiUsage: aiResult.usage,
      sourceSnapshot: snapshot,
      sections: {
        create: template.sections.map((section: TemplateSection) => {
          const fallbackContent = buildFallbackSectionContent(section, snapshot);
          const aiContent = aiResult.drafts.get(section.key);
          return {
            templateSectionId: section.id,
            key: section.key,
            label: section.label,
            status: aiContent ? 'ai_enriched' : 'draft',
            sourceType: section.sourceType,
            sortOrder: section.sortOrder,
            content: mergeAiContent(fallbackContent, aiContent),
            aiModel: aiContent ? aiResult.model : null,
            promptVersion: aiContent ? PROMPT_VERSION : null,
            sourceHash,
            generatedAt: now,
          };
        }),
      },
    },
    include: {
      sections: { orderBy: { sortOrder: 'asc' } },
      template: { include: { sections: { orderBy: { sortOrder: 'asc' } } } },
    },
  });

  await recordAuditEvent({
    action: 'trip_intel_report.created',
    entityType: 'TripIntelReport',
    entityId: String(report.id),
    actorUserId: options.actorUserId,
    metadata: {
      tripId: trip.id,
      templateSlug: DEFAULT_TEMPLATE_SLUG,
      generationStatus: report.generationStatus,
      aiReason: aiResult.reason,
      aiModel: aiResult.model,
      promptVersion: PROMPT_VERSION,
    },
    request: options.request,
  });

  return report;
}

export async function buildTripIntelReportDocxExport(options: {
  tripId: number;
  actorUserId: number;
  request?: NextRequest;
}) {
  const trip = await prisma.trip.findFirst({
    where: {
      id: options.tripId,
      userId: options.actorUserId,
    },
    include: {
      itineraryItems: {
        orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!trip) {
    return null;
  }

  const report = (await ensureTripIntelReportForTrip({
    tripId: trip.id,
    actorUserId: options.actorUserId,
    request: options.request,
  })) as TripIntelReportWithSections;

  const document = new Document({
    creator: 'GeoSecure Platform',
    title: report.title,
    description: 'Venue advance intelligence report export',
    sections: [
      {
        children: buildExportChildren(report, trip),
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  const baseName = slugifyFilename(`${trip.title}-intel-report`) || `trip-${trip.id}-intel-report`;

  return {
    buffer,
    fileName: `${baseName}.docx`,
    report,
    trip,
  };
}
