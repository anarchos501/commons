-- Prevent proposals from reviving after a later stewardship era.

ALTER TABLE "Node"
ADD COLUMN "stewardRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "NodeStewardProposal"
ADD COLUMN "baselineStewardRevision" INTEGER NOT NULL DEFAULT 0;
