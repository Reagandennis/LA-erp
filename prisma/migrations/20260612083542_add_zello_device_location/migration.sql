-- CreateTable
CREATE TABLE "ZelloDeviceLocation" (
    "id" SERIAL NOT NULL,
    "network" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "address" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZelloDeviceLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZelloDeviceLocation_network_channel_idx" ON "ZelloDeviceLocation"("network", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ZelloDeviceLocation_network_channel_device_key" ON "ZelloDeviceLocation"("network", "channel", "device");
