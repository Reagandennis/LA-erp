-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_targetUserId_idx" ON "AuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "CalendarEventNotification_eventId_idx" ON "CalendarEventNotification"("eventId");

-- CreateIndex
CREATE INDEX "Contact_customerId_idx" ON "Contact"("customerId");

-- CreateIndex
CREATE INDEX "CrmActivity_contactId_idx" ON "CrmActivity"("contactId");

-- CreateIndex
CREATE INDEX "Deal_contractId_idx" ON "Deal"("contractId");

-- CreateIndex
CREATE INDEX "FileNotification_fileId_idx" ON "FileNotification"("fileId");

-- CreateIndex
CREATE INDEX "Invoice_sourceQuoteId_idx" ON "Invoice"("sourceQuoteId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "MessageNotification_messageId_idx" ON "MessageNotification"("messageId");

-- CreateIndex
CREATE INDEX "PersonalTodoNotification_todoId_idx" ON "PersonalTodoNotification"("todoId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "TripItineraryItemNotification_itemId_idx" ON "TripItineraryItemNotification"("itemId");

-- CreateIndex
CREATE INDEX "UserModule_moduleId_idx" ON "UserModule"("moduleId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
