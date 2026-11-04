# Documentation

[Docs home](README.md) · [Architecture](structure.md) · [Development](development.md) · [Deployment](deployment.md) · [nginx](nginx.md) · [Operations](operations.md) · [Data analysis](data-analysis.md) · [Project README](../README.md)

## Contents

- [Architecture](structure.md)
  - [Request flow](structure.md#request-flow)
  - [Supporters](structure.md#supporters)
  - [Students](structure.md#students)
  - [Endpoints](structure.md#endpoints)
- [Development](development.md)
  - [Local setup](development.md#local-setup)
  - [Database](development.md#database)
  - [Tests](development.md#tests)
- [Deployment](deployment.md)
  - [What runs on the server](deployment.md#what-runs-on-the-server)
  - [Before you start](deployment.md#before-you-start)
  - [First-time setup](deployment.md#first-time-setup)
  - [Trying the setup locally (test mode)](deployment.md#trying-the-setup-locally-test-mode)
  - [Test server](deployment.md#test-server)
  - [Updating](deployment.md#updating)
- [nginx](nginx.md)
  - [Configuration](nginx.md#configuration)
  - [Database port (5432)](nginx.md#database-port-5432)
  - [Applying changes](nginx.md#applying-changes)
- [Operations](operations.md)
  - [Changing settings](operations.md#changing-settings)
  - [Permissions](operations.md#permissions)
  - [Dashboard pipeline](operations.md#dashboard-pipeline)
  - [Backups and restore](operations.md#backups-and-restore)
  - [Useful commands](operations.md#useful-commands)
- [Data analysis](data-analysis.md)
  - [Database logins](data-analysis.md#database-logins)
  - [Connecting from a notebook](data-analysis.md#connecting-from-a-notebook)
  - [Pipeline](data-analysis.md#pipeline)
  - [Old data](data-analysis.md#old-data)

Component notes:

- [`frontend/readme.md`](../frontend/readme.md): frontend files, features and kiosk mode.
- [`backend/README.md`](../backend/README.md): where student data is stored, and the API.
