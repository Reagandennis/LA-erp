-- CreateTable
CREATE TABLE "MapCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#03458f',
    "icon" TEXT NOT NULL DEFAULT 'pin',
    "scope" TEXT NOT NULL DEFAULT 'both',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapLayer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'drawn',
    "source" TEXT,
    "boundaryType" TEXT,
    "fileName" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "fileContent" BYTEA,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "categoryId" INTEGER,
    "style" JSONB,
    "minLat" DOUBLE PRECISION,
    "minLng" DOUBLE PRECISION,
    "maxLat" DOUBLE PRECISION,
    "maxLng" DOUBLE PRECISION,
    "featureCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapFeature" (
    "id" SERIAL NOT NULL,
    "layerId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "geometryType" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "properties" JSONB,
    "style" JSONB,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapGeofence" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "shape" TEXT NOT NULL DEFAULT 'polygon',
    "geometry" JSONB NOT NULL,
    "style" JSONB,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapGeofence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapDeviceTag" (
    "id" SERIAL NOT NULL,
    "device" TEXT NOT NULL,
    "categoryId" INTEGER,
    "icon" TEXT,
    "label" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapDeviceTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MapCategory_name_key" ON "MapCategory"("name");

-- CreateIndex
CREATE INDEX "MapCategory_sortOrder_idx" ON "MapCategory"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MapLayer_boundaryType_key" ON "MapLayer"("boundaryType");

-- CreateIndex
CREATE INDEX "MapLayer_kind_sortOrder_idx" ON "MapLayer"("kind", "sortOrder");

-- CreateIndex
CREATE INDEX "MapLayer_categoryId_idx" ON "MapLayer"("categoryId");

-- CreateIndex
CREATE INDEX "MapFeature_layerId_idx" ON "MapFeature"("layerId");

-- CreateIndex
CREATE INDEX "MapFeature_categoryId_idx" ON "MapFeature"("categoryId");

-- CreateIndex
CREATE INDEX "MapGeofence_categoryId_idx" ON "MapGeofence"("categoryId");

-- CreateIndex
CREATE INDEX "MapGeofence_visible_idx" ON "MapGeofence"("visible");

-- CreateIndex
CREATE UNIQUE INDEX "MapDeviceTag_device_key" ON "MapDeviceTag"("device");

-- CreateIndex
CREATE INDEX "MapDeviceTag_categoryId_idx" ON "MapDeviceTag"("categoryId");

-- AddForeignKey
ALTER TABLE "MapCategory" ADD CONSTRAINT "MapCategory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapLayer" ADD CONSTRAINT "MapLayer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapLayer" ADD CONSTRAINT "MapLayer_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MapCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapFeature" ADD CONSTRAINT "MapFeature_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "MapLayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapFeature" ADD CONSTRAINT "MapFeature_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MapCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapGeofence" ADD CONSTRAINT "MapGeofence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapGeofence" ADD CONSTRAINT "MapGeofence_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MapCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapDeviceTag" ADD CONSTRAINT "MapDeviceTag_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MapCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
