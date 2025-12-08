# src/ttl_cleanup_handler.py

import json
import os
import boto3

S3 = boto3.client('s3')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET')

def delete_s3_objects(keys_to_delete):
    """Deletes a list of S3 objects, handling both single and multiple files."""
    if not keys_to_delete:
        return

    objects = [{'Key': k} for k in keys_to_delete if k]
    
    # S3 DeleteObjects supports up to 1000 keys per call
    response = S3.delete_objects(
        Bucket=S3_BUCKET_NAME,
        Delete={'Objects': objects}
    )
    
    if response.get('Errors'):
        print(f"WARNING: Failed to delete some objects: {response['Errors']}")
    
    print(f"Successfully initiated deletion for {len(objects)} object(s).")


def lambda_handler(event, context):
    """
    Processes DynamoDB Stream events, looking specifically for TTL deletion events
    to trigger S3 cleanup.
    """
    for record in event['Records']:
        # 1. Only process REMOVE events where the principal is the DynamoDB service itself (TTL)
        is_ttl_event = (
            record['eventName'] == 'REMOVE' and 
            record.get('userIdentity', {}).get('principalId') == 'dynamodb.amazonaws.com'
        )
        
        if is_ttl_event:
            
            # 2. Extract the expired item's data (OldImage contains the full item data)
            old_image = record['dynamodb']['OldImage']
            
            # DDB Stream data uses 'S' for string, 'L' for list, 'M' for map
            access_key = old_image.get('AccessKey', {}).get('S')
            
            if not access_key:
                print("TTL event received but AccessKey not found. Skipping.")
                continue

            print(f"TTL detected for key: {access_key}. Starting S3 cleanup.")

            keys_to_delete = []

            # 3. Handle Text/Code Content (TextS3Key)
            text_s3_key = old_image.get('TextS3Key', {}).get('S')
            if text_s3_key:
                keys_to_delete.append(text_s3_key)
            
            # 4. Handle Associated Files (Files - List of Maps)
            files_list = old_image.get('Files', {}).get('L', [])
            
            if files_list:
                for file_map in files_list:
                    # Traverses the list of maps structure: List > Map > Key/Value String
                    s3_key = file_map.get('M', {}).get('s3_key', {}).get('S')
                    if s3_key:
                        keys_to_delete.append(s3_key)
                        
            # 5. Delete the objects from S3
            delete_s3_objects(keys_to_delete)
        
    return {'statusCode': 200, 'body': 'S3 Cleanup process finished.'}