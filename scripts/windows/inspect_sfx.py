import pefile

def list_resources(pe_path):
    pe = pefile.PE(pe_path)
    if hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        for resource_type in pe.DIRECTORY_ENTRY_RESOURCE.entries:
            type_name = pefile.RESOURCE_TYPE.get(resource_type.id, resource_type.id)
            print(f"Type: {type_name}")
            if hasattr(resource_type, 'directory'):
                for resource_id in resource_type.directory.entries:
                    print(f"  ID: {resource_id.id}")

if __name__ == "__main__":
    list_resources(r"C:\Program Files\7-Zip\7z.sfx")
