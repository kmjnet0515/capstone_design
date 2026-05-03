#!/usr/bin/env python
# -*- coding: utf-8 -*-
#
# compoundfiles – Python library for reading/writing OLE Compound Files (CFB)
#
# Copyright (c) 2026 warlomak <warlomak@gmail.com>
#
# This code is licensed under the MIT License.
# You may use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of this software under the terms of the MIT License.
#
# Original project (forked from): https://github.com/waveform-computing/compoundfiles
# Original author: Dave Hughes <dave@waveform.org.uk>
#
# This file contains fully original code for editing compound files.

from __future__ import (
    unicode_literals,
    absolute_import,
    print_function,
    division,
    )
str = type('')

from .reader import CompoundFileReader
from .writer import CompoundFileWriter
from .entities import CompoundFileEntity
from .errors import *
from .const import *
import tempfile
import os
from array import array
from collections import OrderedDict


class CompoundFileEditor:
    """
    A class for editing existing OLE Compound Document files.
    Allows renaming, deleting, and adding streams/storages to existing files.
    """

    def __init__(self, filename_or_file):
        """
        Initialize the editor with an existing OLE file.
        """
        # Load the existing file into memory
        self.filename = None
        self.file_handle = None

        if isinstance(filename_or_file, str):
            self.filename = filename_or_file
            # Read the existing file structure
            with CompoundFileReader(filename_or_file) as reader:
                self._load_from_reader(reader)
        else:
            # Assume it's a file-like object
            self.file_handle = filename_or_file
            # We need to get the data first, so we'll read it into memory
            self.file_handle.seek(0)
            data = self.file_handle.read()
            # Create a temporary file to work with
            with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
                tmp_file.write(data)
                tmp_filename = tmp_file.name

            try:
                with CompoundFileReader(tmp_filename) as reader:
                    self._load_from_reader(reader)
            finally:
                os.unlink(tmp_filename)

    def _load_from_reader(self, reader):
        """
        Load the file structure from a CompoundFileReader instance.
        """
        # Store the structure as dictionaries for easier manipulation
        self.structure = {}
        self.stream_data = {}

        # Create root entry
        self.structure['/'] = {
            'name': 'Root Entry',  # Root entry name
            'type': 'storage',  # Root is always a storage
            'size': 0,
            'children': OrderedDict()
        }

        # Process root entity's children
        if hasattr(reader.root, '_children') and reader.root._children:
            for child in reader.root._children:
                child_path = '/' + child.name
                self._load_entity_recursive(reader, child, child_path)

        # Set root property for convenience
        self.root = self.structure['/']

    def _load_entity_recursive(self, reader, entity, path):
        """
        Recursively load entity structure and data.
        """
        # Store entity info
        entity_info = {
            'name': entity.name,
            'type': 'stream' if entity.isfile else 'storage',
            'size': entity.size if hasattr(entity, 'size') else 0,
            'children': OrderedDict()
        }

        self.structure[path] = entity_info

        # Add this entity to its parent's children
        if path != '/':
            parent_path = self._get_parent_path(path)
            if parent_path and parent_path in self.structure:
                parent_info = self.structure[parent_path]
                # Use the child's name as the key in the parent's children dict
                parent_info['children'][path] = entity_info

        # Load data if it's a stream
        if entity.isfile:
            try:
                with reader.open(entity) as stream:
                    self.stream_data[path] = stream.read()
            except:
                self.stream_data[path] = b''

        # Process children if it's a storage
        if entity.isdir and hasattr(entity, '_children') and entity._children:
            for child in entity._children:
                child_path = path.rstrip('/') + '/' + child.name if path != '/' else '/' + child.name
                self._load_entity_recursive(reader, child, child_path)

    def _get_entity_info_by_path(self, path):
        """
        Get entity info by path.
        """
        if path in self.structure:
            return self.structure[path]
        return None

    def _get_parent_path(self, path):
        """
        Get the parent path of an entity.
        """
        if path == '/':
            return None
        parts = path.strip('/').split('/')
        if len(parts) <= 1:
            return '/'
        parent_parts = parts[:-1]
        return '/' + '/'.join(parent_parts)

    def _normalize_path(self, path):
        """
        Normalize a path to the internal format (starting with /).
        """
        if not path.startswith('/'):
            # If it doesn't start with /, assume it's relative to root
            path = '/' + path
        return path

    def rename(self, old_path, new_name):
        """
        Rename a stream or storage.

        :param old_path: Path to the entity to rename (e.g., 'storage/stream')
        :param new_name: New name for the entity
        """
        old_path = self._normalize_path(old_path)
        if old_path not in self.structure:
            raise CompoundFileNotFoundError(f"Entity not found: {old_path}")

        entity_info = self.structure[old_path]
        parent_path = self._get_parent_path(old_path)

        if parent_path:
            parent_info = self.structure[parent_path]
            # Check if new name already exists in parent
            # Create the potential new path to check
            new_path_check = parent_path.rstrip('/') + '/' + new_name if parent_path != '/' else '/' + new_name
            if new_path_check in parent_info['children']:
                raise CompoundFileError(f"Entity with name '{new_name}' already exists in parent")

            # Remove from parent's children with old name
            for old_key, child_info in list(parent_info['children'].items()):
                if old_key == old_path:  # Match by path
                    # Create new key with new name
                    new_child_path = parent_path.rstrip('/') + '/' + new_name if parent_path != '/' else '/' + new_name
                    parent_info['children'][new_child_path] = parent_info['children'][old_key]
                    del parent_info['children'][old_key]
                    break

        # Update the entity's name
        entity_info['name'] = new_name

        # Update the main structure dictionary key
        # We need to update the path in the structure dict
        self._update_path_in_structure(old_path, new_path_check)

    def _update_path_in_structure(self, old_path, new_path):
        """
        Update the path in the structure dictionary and adjust all children paths.
        """
        # Move the entity info to the new path
        if old_path in self.structure:
            self.structure[new_path] = self.structure[old_path]
            del self.structure[old_path]

        # Update data path if it's a stream
        if old_path in self.stream_data:
            self.stream_data[new_path] = self.stream_data[old_path]
            del self.stream_data[old_path]

        # Update the parent's children dictionary to reflect the new path
        parent_path = self._get_parent_path(old_path)
        if parent_path and parent_path in self.structure:
            parent_info = self.structure[parent_path]
            # Remove the old path from parent's children
            if old_path in parent_info['children']:
                # Update the child info to use the new name
                child_info = parent_info['children'][old_path]
                # Remove old entry
                del parent_info['children'][old_path]
                # Add with new path
                parent_info['children'][new_path] = child_info

        # Update all children paths recursively
        # Find all paths that start with old_path/
        paths_to_update = []
        for path in self.structure.keys():
            if path.startswith(old_path + '/'):
                paths_to_update.append(path)

        for path in paths_to_update:
            # Create new path by replacing old_path with new_path
            new_child_path = path.replace(old_path, new_path, 1)

            self.structure[new_child_path] = self.structure[path]
            del self.structure[path]

            # Update data path if it's a stream
            if path in self.stream_data:
                self.stream_data[new_child_path] = self.stream_data[path]
                del self.stream_data[path]

            # Also update parent's children references
            grandparent_path = self._get_parent_path(path)
            if grandparent_path and grandparent_path in self.structure:
                grandparent_info = self.structure[grandparent_path]
                if path in grandparent_info['children']:
                    child_info = grandparent_info['children'][path]
                    del grandparent_info['children'][path]
                    grandparent_info['children'][new_child_path] = child_info

        # Also update the children list in the renamed entity itself
        # This handles the case where a storage is renamed and we need to update
        # the paths of its children in its own children dictionary
        if new_path in self.structure:
            entity_info = self.structure[new_path]
            # Create a new children dict with updated paths
            updated_children = OrderedDict()
            for child_path, child_info in entity_info['children'].items():
                # Update the child path to reflect the parent's rename
                updated_child_path = child_path.replace(old_path, new_path, 1)
                updated_children[updated_child_path] = child_info
            entity_info['children'] = updated_children

    def delete(self, path):
        """
        Delete a stream or storage.

        :param path: Path to the entity to delete (e.g., 'storage/stream')
        """
        path = self._normalize_path(path)
        if path not in self.structure:
            raise CompoundFileNotFoundError(f"Entity not found: {path}")

        # Remove from parent's children
        parent_path = self._get_parent_path(path)
        if parent_path and parent_path in self.structure:
            parent_info = self.structure[parent_path]
            # Remove from parent's children
            for child_path, child_info in list(parent_info['children'].items()):
                if child_path == path or child_info['name'] == self.structure[path]['name']:
                    del parent_info['children'][child_path]
                    break

        # Remove the entity and all its children recursively
        self._remove_entity_and_children(path)

    def _remove_entity_and_children(self, path):
        """
        Remove an entity and all its children recursively.
        """
        # Remove from structure
        if path in self.structure:
            del self.structure[path]

        # Remove from stream data if it's a stream
        if path in self.stream_data:
            del self.stream_data[path]

        # Remove all children recursively
        child_paths = [p for p in self.structure.keys() if p.startswith(path + '/')]
        for child_path in child_paths:
            self._remove_entity_and_children(child_path)

    def add_stream(self, parent_path, name, data):
        """
        Add a new stream to the specified parent storage.

        :param parent_path: Path to the parent storage
        :param name: Name of the new stream
        :param data: Data for the new stream
        """
        parent_path = self._normalize_path(parent_path)
        if parent_path not in self.structure:
            raise CompoundFileNotFoundError(f"Parent not found: {parent_path}")

        parent_info = self.structure[parent_path]
        if parent_info['type'] != 'storage':
            raise CompoundFileError(f"Parent must be a storage, not {parent_info['type']}")

        # Check if name already exists
        child_path = parent_path.rstrip('/') + '/' + name if parent_path != '/' else '/' + name
        if child_path in parent_info['children']:
            raise CompoundFileError(f"Entity with name '{name}' already exists in parent")

        # Create new stream entity
        new_stream_path = child_path
        new_stream_info = {
            'name': name,
            'type': 'stream',
            'size': len(data),
            'children': OrderedDict()
        }

        # Add to parent
        parent_info['children'][new_stream_path] = new_stream_info
        self.structure[new_stream_path] = new_stream_info
        self.stream_data[new_stream_path] = data

        return new_stream_info

    def add_storage(self, parent_path, name):
        """
        Add a new storage to the specified parent storage.

        :param parent_path: Path to the parent storage
        :param name: Name of the new storage
        """
        parent_path = self._normalize_path(parent_path)
        if parent_path not in self.structure:
            raise CompoundFileNotFoundError(f"Parent not found: {parent_path}")

        parent_info = self.structure[parent_path]
        if parent_info['type'] != 'storage':
            raise CompoundFileError(f"Parent must be a storage, not {parent_info['type']}")

        # Check if name already exists
        child_path = parent_path.rstrip('/') + '/' + name if parent_path != '/' else '/' + name
        if child_path in parent_info['children']:
            raise CompoundFileError(f"Entity with name '{name}' already exists in parent")

        # Create new storage entity
        new_storage_path = child_path
        new_storage_info = {
            'name': name,
            'type': 'storage',
            'size': 0,
            'children': OrderedDict()
        }

        # Add to parent
        parent_info['children'][new_storage_path] = new_storage_info
        self.structure[new_storage_path] = new_storage_info

        return new_storage_info

    def _recreate_structure(self, writer, parent_path='/'):
        """
        Recursively recreate the structure in the writer.
        """
        if parent_path in self.structure:
            entity_info = self.structure[parent_path]

            # Process all children of this entity
            for child_path, child_info in entity_info['children'].items():
                if child_info['type'] == 'stream':
                    # Create stream with data
                    stream_data = self.stream_data.get(child_path, b'')
                    stream_name = child_info['name']
                    writer.create_stream(writer.root if parent_path == '/' else self._get_writer_entity_by_path(writer, parent_path), stream_name, stream_data)
                elif child_info['type'] == 'storage':
                    # Create storage
                    storage_name = child_info['name']
                    parent_entity = writer.root if parent_path == '/' else self._get_writer_entity_by_path(writer, parent_path)
                    new_storage = writer.create_storage(parent_entity, storage_name)

                    # Recursively recreate its children
                    self._recreate_structure(writer, child_path)

    def _get_writer_entity_by_path(self, writer, path):
        """
        Get an entity from the writer by path (this is a helper for reconstruction).
        This is a simplified version - in practice, we'd need to track entities differently.
        """
        # This is a simplified implementation - for a real implementation we'd need
        # to maintain a mapping between paths and entities during construction
        # For now, we'll reconstruct the structure directly in save method
        pass

    def save(self, filename=None):
        """
        Save the modified structure to a file.

        :param filename: Filename to save to. If None, saves to original file.
        """
        target_filename = filename or self.filename

        if target_filename is None:
            raise CompoundFileError("No filename specified and no original file to save to")

        # Create a new file with the modified structure
        with CompoundFileWriter(target_filename) as writer:
            # Recreate the root structure
            self._recreate_full_structure(writer)

    def _recreate_full_structure(self, writer):
        """
        Recreate the entire structure in the writer.
        """
        # Process root's children
        root_info = self.structure.get('/', {})
        if root_info:
            for child_path, child_info in root_info['children'].items():
                self._recreate_element(writer, child_path, writer.root)

    def _recreate_element(self, writer, element_path, parent_entity):
        """
        Recreate a single element and its children recursively.
        """
        if element_path in self.structure:
            element_info = self.structure[element_path]

            if element_info['type'] == 'stream':
                # Create stream with data
                stream_data = self.stream_data.get(element_path, b'')
                writer.create_stream(parent_entity, element_info['name'], stream_data)
            elif element_info['type'] == 'storage':
                # Create storage
                new_storage = writer.create_storage(parent_entity, element_info['name'])

                # Recursively recreate its children
                for child_path, child_info in element_info['children'].items():
                    self._recreate_element(writer, child_path, new_storage)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        # Nothing special to do on exit
        pass