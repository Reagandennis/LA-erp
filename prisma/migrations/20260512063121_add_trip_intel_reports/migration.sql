-- CreateTable
CREATE TABLE "public"."TripIntelReport" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "primaryVenueId" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generationStatus" TEXT NOT NULL DEFAULT 'pending',
    "overallRiskLevel" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "aiModel" TEXT,
    "aiPromptVersion" TEXT,
    "aiSourceHash" TEXT,
    "aiUsage" JSONB,
    "sourceSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripIntelReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IntelReportTemplate" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IntelReportTemplateSection" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "promptHint" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'mixed',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelReportTemplateSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TripIntelReportSection" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "templateSectionId" INTEGER,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceType" TEXT NOT NULL DEFAULT 'mixed',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB,
    "notes" TEXT,
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "sourceHash" TEXT,
    "generatedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripIntelReportSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Venue" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB,
    "categoryType" TEXT NOT NULL,
    "description" TEXT,
    "narrative" TEXT,
    "roomsCount" INTEGER,
    "costEstimatePerNightCents" INTEGER,
    "hasRestaurant" BOOLEAN,
    "hasCafe" BOOLEAN,
    "mapImageUrl" TEXT,
    "frontViewPhotoUrl" TEXT,
    "commonAreaPhotoUrls" JSONB,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "googleMapsUrl" TEXT,
    "physicalAddress" TEXT,
    "geofence" JSONB,
    "automaticRouteNotes" JSONB,
    "generalContact" JSONB,
    "managerContact" JSONB,
    "securityContact" JSONB,
    "siteSpecificDetails" JSONB,
    "parkingDetails" JSONB,
    "securityDetails" JSONB,
    "emergencyProcedures" JSONB,
    "riskAssessment" JSONB,
    "dataSources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Hospital" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "level" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT,
    "phoneNumber" TEXT,
    "email" TEXT,
    "googleMapsUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VenueHospitalLink" (
    "id" SERIAL NOT NULL,
    "venueId" INTEGER NOT NULL,
    "hospitalId" INTEGER NOT NULL,
    "routeDistanceKm" DOUBLE PRECISION,
    "routeDurationMinutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueHospitalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripIntelReport_tripId_updatedAt_idx" ON "public"."TripIntelReport"("tripId", "updatedAt");

-- CreateIndex
CREATE INDEX "TripIntelReport_templateId_idx" ON "public"."TripIntelReport"("templateId");

-- CreateIndex
CREATE INDEX "TripIntelReport_primaryVenueId_idx" ON "public"."TripIntelReport"("primaryVenueId");

-- CreateIndex
CREATE UNIQUE INDEX "TripIntelReport_tripId_version_key" ON "public"."TripIntelReport"("tripId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IntelReportTemplate_slug_key" ON "public"."IntelReportTemplate"("slug");

-- CreateIndex
CREATE INDEX "IntelReportTemplate_isDefault_updatedAt_idx" ON "public"."IntelReportTemplate"("isDefault", "updatedAt");

-- CreateIndex
CREATE INDEX "IntelReportTemplateSection_templateId_sortOrder_idx" ON "public"."IntelReportTemplateSection"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "IntelReportTemplateSection_templateId_key_key" ON "public"."IntelReportTemplateSection"("templateId", "key");

-- CreateIndex
CREATE INDEX "TripIntelReportSection_reportId_sortOrder_idx" ON "public"."TripIntelReportSection"("reportId", "sortOrder");

-- CreateIndex
CREATE INDEX "TripIntelReportSection_templateSectionId_idx" ON "public"."TripIntelReportSection"("templateSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "TripIntelReportSection_reportId_key_key" ON "public"."TripIntelReportSection"("reportId", "key");

-- CreateIndex
CREATE INDEX "Venue_categoryType_name_idx" ON "public"."Venue"("categoryType", "name");

-- CreateIndex
CREATE INDEX "Hospital_city_name_idx" ON "public"."Hospital"("city", "name");

-- CreateIndex
CREATE INDEX "VenueHospitalLink_hospitalId_idx" ON "public"."VenueHospitalLink"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueHospitalLink_venueId_hospitalId_key" ON "public"."VenueHospitalLink"("venueId", "hospitalId");

-- AddForeignKey
ALTER TABLE "public"."TripIntelReport" ADD CONSTRAINT "TripIntelReport_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripIntelReport" ADD CONSTRAINT "TripIntelReport_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."IntelReportTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripIntelReport" ADD CONSTRAINT "TripIntelReport_primaryVenueId_fkey" FOREIGN KEY ("primaryVenueId") REFERENCES "public"."Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."IntelReportTemplateSection" ADD CONSTRAINT "IntelReportTemplateSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."IntelReportTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripIntelReportSection" ADD CONSTRAINT "TripIntelReportSection_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "public"."TripIntelReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripIntelReportSection" ADD CONSTRAINT "TripIntelReportSection_templateSectionId_fkey" FOREIGN KEY ("templateSectionId") REFERENCES "public"."IntelReportTemplateSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VenueHospitalLink" ADD CONSTRAINT "VenueHospitalLink_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VenueHospitalLink" ADD CONSTRAINT "VenueHospitalLink_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "public"."Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
