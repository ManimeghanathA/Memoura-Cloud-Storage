# Memoura: Ephemeral Storage, Effortlessly Managed

<p align="center">
  <img src="https://github.com/ManimeghanathA/Memoura-Cloud-Storage/blob/main/IMG_20251027_131813_X-Design-star_no%20background.png" alt="Memoura Logo" width="400" height="400" />
</p>

**Memoura** is a modern, fully serverless application designed for secure, friction-free, and transient data sharing. It solves the problem of digital clutter and data retention risk by guaranteeing that content—whether it's code, notes, or large files—is permanently purged after a defined time-to-live (TTL) or a single access.

## 🚀 Live Demo & Core Value

* **Try it Live:** `bit.ly/memoura`
* **The Goal:** Eliminate distractions from email and messaging apps by providing a quick, secure, and ephemeral mechanism for sharing resources between devices or collaborators.

## ✨ Key Features

* **Guaranteed Ephemerality:** Data and files are permanently deleted from S3, powered by **DynamoDB TTL** and a dedicated S3 Cleanup Lambda function.
* **Hybrid Content Mode:** Share multiple files **and** custom text/code within a single, unified link.
* **AI Code Formatting:** Uses a modern AI model to automatically detect code language, clean messy indentation, and return beautifully highlighted Markdown for easy sharing and readability.
* **Zero-Compute File Transfer:** All large file uploads and downloads utilize secure **S3 Presigned URLs**, keeping Lambda compute paths free and fast.
* **Layered Security:** Supports optional **Password Protection** (using SHA-256 hashing) and **One-Time Access** deletion on first retrieval.
* **Custom Keys:** Define your own access key (e.g., `MY-PROJECT-V1`) for easy sharing.

## 🏛️ Architecture Overview

Memoura is built on a scalable and cost-efficient **AWS Serverless** architecture defined entirely in the `template.yaml`.

The core ephemeral promise is fulfilled by combining three AWS services in an event-driven flow:

1.  **DynamoDB (`StorageMetadataTable`):** Stores metadata (TTL, Access Mode, S3 Pointers) and is configured to automatically expire items using the `ExpiryTimestamp` attribute.
2.  **DynamoDB Stream:** Triggers immediately upon item removal (due to TTL).
3.  **TTL Cleanup Lambda (`ttl_cleanup_handler.py`):** Deletes the corresponding file(s) from S3, ensuring data is permanently removed from storage.


| Component | Function Handlers | Description |
| :--- | :--- | :--- |
| **API Gateway** | `check_key`, `store`, `retrieve`, `format-preview` | The single entry point for all client interactions. |
| **AWS Lambda** | 5 distinct Python 3.12 functions. | Handles key validation, S3 Presigned URL generation, DynamoDB transactions, and AI API calls. |
| **S3** | `FileStorageBucket` | Stores content/files securely. Lifecycle Rules automatically clean up abandoned AI cache folders. |
| **Secrets Manager** | `GEMINI_SECRET_ARN` | Securely stores the Gemini API key, retrieved during Lambda cold start. |

## 🛠️ Deployment Guide (Using SAM CLI)

This project is configured to be built and deployed using the **AWS Serverless Application Model (SAM) CLI**.

### Prerequisites

You need the following tools installed and configured:

1.  **AWS CLI:** Configured with credentials for deployment.
2.  **SAM CLI:** [Install the SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
3.  **Docker:** Required for `sam build --use-container`.
4.  **Python 3.12+**
5.  **Gemini API Key:** You must create an entry in **AWS Secrets Manager** to store your Gemini API key (as referenced by the ARN in `template.yaml`).

### Step 1: Build the Project

From the root directory of this repository, run the build command. This packages your Lambda dependencies (including `google-genai` and `boto3`).

```bash
sam build --use-container
```

### Step 2: Deploy to AWS

Run the guided deployment process. The stack name should be unique (e.g., `MemouraStorageStack`).

```bash
sam deploy --guided
```

You will be prompted to enter parameters. Ensure you accept the following defaults and provide your stack name:

### Stack Name: TimeBoundStorage (or your chosen name)

### AWS Region: Your preferred region (e.g., us-east-1)

Allow SAM CLI IAM role creation: Yes (Required to create the necessary permissions for Lambda functions).

The deployment output will display the CloudFront URL and the API Gateway Endpoints.

## 🧹 Cleanup
To completely remove all resources created by this stack (DynamoDB table, S3 buckets, Lambda functions, API Gateway, and CloudFormation stack), use the AWS CLI. Assuming you used your project name for the stack name:

```Bash
sam delete --stack-name "TimeBoundStorage"
```

## 🧑‍💻 Contributing
We welcome feedback and contributions! If you have suggestions for new features (e.g., file encryption, custom domain setup) or spot a bug, please feel free to open an Issue or submit a Pull Request.

## Resources
1. [AWS SAM Developer Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html)
2. [AWS Serverless Application Model (SAM) Specification](https://github.com/aws/serverless-application-model)

