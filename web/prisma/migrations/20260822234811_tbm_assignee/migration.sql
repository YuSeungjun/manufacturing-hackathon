-- CreateTable
CREATE TABLE "TbmAssignee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tbmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "TbmAssignee_tbmId_fkey" FOREIGN KEY ("tbmId") REFERENCES "Tbm" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TbmAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TbmAssignee_tbmId_userId_key" ON "TbmAssignee"("tbmId", "userId");

-- 기존 TBM 은 "작업조 전원"이 서명 대상이었다. 그 규칙 그대로 채워 넣어
-- 이미 있는 기록의 서명률이 달라지지 않게 한다.
INSERT INTO "TbmAssignee" ("id", "tbmId", "userId")
SELECT lower(hex(randomblob(16))), t."id", u."id"
FROM "Tbm" t
JOIN "User" u ON u."teamId" = t."teamId" AND u."role" = 'WORKER';
