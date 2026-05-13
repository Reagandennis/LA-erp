/*
  Warnings:

  - You are about to drop the column `tripId` on the `PersonalTodo` table. All the data in the column will be lost.
  - You are about to drop the `ChatAttachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ChatConversation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ChatMember` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ChatMessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ChatReaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Hospital` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `IntelReportTemplate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `IntelReportTemplateSection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Trip` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TripClientPortal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TripIntelReport` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TripIntelReportSection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TripInvoice` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TripItineraryItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TripProposal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Venue` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VenueHospitalLink` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."ChatAttachment" DROP CONSTRAINT "ChatAttachment_messageId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChatConversation" DROP CONSTRAINT "ChatConversation_createdById_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChatMember" DROP CONSTRAINT "ChatMember_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChatMember" DROP CONSTRAINT "ChatMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChatMessage" DROP CONSTRAINT "ChatMessage_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChatMessage" DROP CONSTRAINT "ChatMessage_senderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChatReaction" DROP CONSTRAINT "ChatReaction_messageId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChatReaction" DROP CONSTRAINT "ChatReaction_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."IntelReportTemplateSection" DROP CONSTRAINT "IntelReportTemplateSection_templateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PersonalTodo" DROP CONSTRAINT "PersonalTodo_tripId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Trip" DROP CONSTRAINT "Trip_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripClientPortal" DROP CONSTRAINT "TripClientPortal_tripId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripIntelReport" DROP CONSTRAINT "TripIntelReport_primaryVenueId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripIntelReport" DROP CONSTRAINT "TripIntelReport_templateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripIntelReport" DROP CONSTRAINT "TripIntelReport_tripId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripIntelReportSection" DROP CONSTRAINT "TripIntelReportSection_reportId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripIntelReportSection" DROP CONSTRAINT "TripIntelReportSection_templateSectionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripInvoice" DROP CONSTRAINT "TripInvoice_tripId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripItineraryItem" DROP CONSTRAINT "TripItineraryItem_tripId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TripProposal" DROP CONSTRAINT "TripProposal_tripId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VenueHospitalLink" DROP CONSTRAINT "VenueHospitalLink_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VenueHospitalLink" DROP CONSTRAINT "VenueHospitalLink_venueId_fkey";

-- DropIndex
DROP INDEX "public"."PersonalTodo_tripId_idx";

-- AlterTable
ALTER TABLE "public"."PersonalTodo" DROP COLUMN "tripId";

-- DropTable
DROP TABLE "public"."ChatAttachment";

-- DropTable
DROP TABLE "public"."ChatConversation";

-- DropTable
DROP TABLE "public"."ChatMember";

-- DropTable
DROP TABLE "public"."ChatMessage";

-- DropTable
DROP TABLE "public"."ChatReaction";

-- DropTable
DROP TABLE "public"."Hospital";

-- DropTable
DROP TABLE "public"."IntelReportTemplate";

-- DropTable
DROP TABLE "public"."IntelReportTemplateSection";

-- DropTable
DROP TABLE "public"."Trip";

-- DropTable
DROP TABLE "public"."TripClientPortal";

-- DropTable
DROP TABLE "public"."TripIntelReport";

-- DropTable
DROP TABLE "public"."TripIntelReportSection";

-- DropTable
DROP TABLE "public"."TripInvoice";

-- DropTable
DROP TABLE "public"."TripItineraryItem";

-- DropTable
DROP TABLE "public"."TripProposal";

-- DropTable
DROP TABLE "public"."Venue";

-- DropTable
DROP TABLE "public"."VenueHospitalLink";

-- DropEnum
DROP TYPE "public"."ConversationType";
