// CortexOS KuzuDB Property Graph DDL (Step 1)
CREATE NODE TABLE ModuleNode(
  id STRING,
  name STRING,
  path STRING,
  responsibility STRING,
  updatedAt INT64,
  PRIMARY KEY (id)
);

CREATE NODE TABLE FileNode(
  path STRING,
  moduleId STRING,
  language STRING,
  sha256 STRING,
  loc INT32,
  lastModified INT64,
  PRIMARY KEY (path)
);

CREATE NODE TABLE SymbolNode(
  id STRING,
  name STRING,
  kind STRING,
  filePath STRING,
  signature STRING,
  startLine INT32,
  endLine INT32,
  exported BOOLEAN,
  PRIMARY KEY (id)
);

CREATE NODE TABLE DecisionNode(
  id STRING,
  title STRING,
  rationale STRING,
  status STRING,
  createdAt INT64,
  PRIMARY KEY (id)
);

CREATE NODE TABLE RequirementNode(
  id STRING,
  description STRING,
  priority STRING,
  status STRING,
  PRIMARY KEY (id)
);

CREATE NODE TABLE TaskNode(
  id STRING,
  title STRING,
  status STRING,
  assignedAgent STRING,
  allowedWriteFiles STRING[],
  updatedAt INT64,
  PRIMARY KEY (id)
);

CREATE NODE TABLE BugNode(
  id STRING,
  symptom STRING,
  rootCause STRING,
  resolution STRING,
  status STRING,
  PRIMARY KEY (id)
);

CREATE NODE TABLE SessionTurnNode(
  id STRING,
  platform STRING,
  sessionId STRING,
  summary STRING,
  tokensSaved INT32,
  timestamp INT64,
  PRIMARY KEY (id)
);

// Relationship Tables
CREATE REL TABLE CONTAINS_FILE(FROM ModuleNode TO FileNode);
CREATE REL TABLE DECLARES_SYMBOL(FROM FileNode TO SymbolNode);
CREATE REL TABLE CALLS_SYMBOL(FROM SymbolNode TO SymbolNode);
CREATE REL TABLE IMPORTS_FILE(FROM FileNode TO FileNode);
CREATE REL TABLE GOVERNS_MODULE(FROM DecisionNode TO ModuleNode);
CREATE REL TABLE IMPLEMENTS_REQ(FROM TaskNode TO RequirementNode);
CREATE REL TABLE TOUCHES_FILE(FROM TaskNode TO FileNode);
CREATE REL TABLE AFFECTS_SYMBOL(FROM BugNode TO SymbolNode);
CREATE REL TABLE RECORDED_IN(FROM SessionTurnNode TO TaskNode);
