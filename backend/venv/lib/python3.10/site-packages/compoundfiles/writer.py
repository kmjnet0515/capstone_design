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
# This file contains fully original code for writing compound files.

from __future__ import (
    unicode_literals,
    absolute_import,
    print_function,
    division,
    )
str = type('')

import io
import struct
import datetime as dt
import logging
from array import array
from collections import OrderedDict

# Assuming const and errors modules are available as in the original setup
from compoundfiles.errors import CompoundFileError
from compoundfiles.const import (
    COMPOUND_MAGIC, FREE_SECTOR, END_OF_CHAIN, NORMAL_FAT_SECTOR,
    MASTER_FAT_SECTOR, COMPOUND_HEADER, DIR_HEADER, DIR_INVALID, DIR_STORAGE,
    DIR_STREAM, DIR_ROOT, NO_STREAM, FILENAME_ENCODING
)

# Define FATSECT and DIFSECT constants as per OLE specification
FATSECT = NORMAL_FAT_SECTOR  # 0xFFFFFFFD
DIFSECT = MASTER_FAT_SECTOR  # 0xFFFFFFFC

# --- Red-Black Tree Implementation Start ---

class RedBlackNode:
    """A node in the red-black tree."""
    def __init__(self, entity, entity_index):
        self.entity = entity
        self.entity_index = entity_index
        self.parent = None
        self.left = None
        self.right = None
        self.color = 0  # New nodes are always red (0 as per spec)

class RedBlackTree:
    """
    A compliant Red-Black Tree implementation for storing directory entries
    as required by the MS-CFB specification.
    """
    COLOR_RED = 0
    COLOR_BLACK = 1

    def __init__(self):
        self.TNULL = RedBlackNode(None, NO_STREAM)
        self.TNULL.color = self.COLOR_BLACK
        self.TNULL.left = None
        self.TNULL.right = None
        self.TNULL.parent = None # Added for stricter compliance
        self.root = self.TNULL

    def _compare_nodes(self, name1, name2):
        """
        Compares two entity names according to MS-CFB spec.
        1. Shorter name is smaller.
        2. If same length, case-insensitive lexicographical comparison.
        """
        len1 = len(name1)
        len2 = len(name2)
        if len1 < len2:
            return -1
        if len1 > len2:
            return 1
        
        name1_upper = name1.upper()
        name2_upper = name2.upper()
        if name1_upper < name2_upper:
            return -1
        if name1_upper > name2_upper:
            return 1
        return 0

    def left_rotate(self, x):
        y = x.right
        x.right = y.left
        if y.left != self.TNULL:
            y.left.parent = x

        y.parent = x.parent
        if x.parent is None:
            self.root = y
        elif x == x.parent.left:
            x.parent.left = y
        else:
            x.parent.right = y
        y.left = x
        x.parent = y

    def right_rotate(self, x):
        y = x.left
        x.left = y.right
        if y.right != self.TNULL:
            y.right.parent = x

        y.parent = x.parent
        if x.parent is None:
            self.root = y
        elif x == x.parent.right:
            x.parent.right = y
        else:
            x.parent.left = y
        y.right = x
        x.parent = y

    def insert(self, entity, entity_index):
        node = RedBlackNode(entity, entity_index)
        node.left = self.TNULL
        node.right = self.TNULL

        y = None
        x = self.root

        while x != self.TNULL:
            y = x
            if self._compare_nodes(node.entity.name, y.entity.name) < 0:
                x = x.left
            else:
                x = x.right

        node.parent = y
        if y is None:
            self.root = node
        elif self._compare_nodes(node.entity.name, y.entity.name) < 0:
            y.left = node
        else:
            y.right = node

        if node.parent is None:
            node.color = self.COLOR_BLACK
            return

        if node.parent.parent is None:
            return

        self._fix_insert(node)

    def _fix_insert(self, k):
        while k.parent.color == self.COLOR_RED:
            if k.parent == k.parent.parent.right:
                u = k.parent.parent.left
                if u.color == self.COLOR_RED:
                    u.color = self.COLOR_BLACK
                    k.parent.color = self.COLOR_BLACK
                    k.parent.parent.color = self.COLOR_RED
                    k = k.parent.parent
                else:
                    if k == k.parent.left:
                        k = k.parent
                        self.right_rotate(k)
                    k.parent.color = self.COLOR_BLACK
                    k.parent.parent.color = self.COLOR_RED
                    self.left_rotate(k.parent.parent)
            else:
                u = k.parent.parent.right
                if u.color == self.COLOR_RED:
                    u.color = self.COLOR_BLACK
                    k.parent.color = self.COLOR_BLACK
                    k.parent.parent.color = self.COLOR_RED
                    k = k.parent.parent
                else:
                    if k == k.parent.right:
                        k = k.parent
                        self.left_rotate(k)
                    k.parent.color = self.COLOR_BLACK
                    k.parent.parent.color = self.COLOR_RED
                    self.right_rotate(k.parent.parent)
            if k == self.root:
                break
        self.root.color = self.COLOR_BLACK

# --- Red-Black Tree Implementation End ---

class CompoundFileWriter(object):
    """
    Provides an interface for creating `OLE Compound Document`_ files.
    """

    def __init__(self, filename_or_obj, sector_size=512):
        self.logger = logging.getLogger(__name__)
        super(CompoundFileWriter, self).__init__()

        if isinstance(filename_or_obj, (str, bytes)):
            self._opened = True
            self._file = io.open(filename_or_obj, 'wb')
        else:
            self._opened = False
            self._file = filename_or_obj

        self._sector_size = sector_size
        self._mini_sector_size = 64
        self._mini_size_limit = 4096
        self._dll_version = 3

        self._all_streams = []
        self._all_storages = []
        self._mini_fat_sectors = []
        self._mini_fat_start_sector = END_OF_CHAIN
        self._mini_stream_sectors = []
        self._mini_storage_sectors = []

        self.root = CompoundFileEntity(
            name='Root Entry',
            entity_type=DIR_ROOT,
            size=0,
            start_sector=END_OF_CHAIN
        )
        self._all_storages.append(self.root)

    def create_stream(self, parent, name, data=None):
        if data is None:
            data = b''
        entity = CompoundFileEntity(
            name=name, entity_type=DIR_STREAM, size=len(data),
            start_sector=END_OF_CHAIN
        )
        parent.add_child(entity)
        self._all_streams.append(entity)
        entity.data = data
        return entity

    def create_storage(self, parent, name):
        entity = CompoundFileEntity(
            name=name, entity_type=DIR_STORAGE, size=0, start_sector=0
        )
        parent.add_child(entity)
        self._all_storages.append(entity)
        return entity

    def close(self):
        try:
            self._finalize_structure()

            max_physical_sector = 0
            all_physical_sectors = (self._dir_sectors + 
                                    self._fat_sectors + 
                                    self._difat_sectors + 
                                    self._mini_fat_sectors + 
                                    self._mini_storage_sectors)
            for entity in self._all_streams:
                if hasattr(entity, 'sector_chain') and entity.sector_chain:
                    all_physical_sectors.extend(entity.sector_chain)
            
            if all_physical_sectors:
                max_physical_sector = max(all_physical_sectors)

            total_physical_sectors = max_physical_sector + 1
            file_sectors = [bytearray(self._sector_size) for _ in range(total_physical_sectors + 1)]

            header_data = self._prepare_header()
            dir_data = self._prepare_directory()
            data_chunks = self._prepare_data()
            fat_data = self._prepare_fat()
            difat_data = self._prepare_difat()

            file_sectors[0][:len(header_data)] = header_data

            for i, logical_sector in enumerate(self._dir_sectors):
                start = i * self._sector_size
                end = start + self._sector_size
                dir_chunk = dir_data[start:end]
                if logical_sector + 1 < len(file_sectors):
                    file_sectors[logical_sector + 1][:len(dir_chunk)] = dir_chunk

            for logical_sector, chunk in data_chunks.items():
                if logical_sector + 1 < len(file_sectors):
                    file_sectors[logical_sector + 1][:len(chunk)] = chunk

            for i, logical_sector in enumerate(self._fat_sectors):
                start = i * self._sector_size
                end = start + self._sector_size
                fat_chunk = fat_data[start:end]
                if logical_sector + 1 < len(file_sectors):
                    file_sectors[logical_sector + 1][:len(fat_chunk)] = fat_chunk

            for i, logical_sector in enumerate(self._difat_sectors):
                start = i * self._sector_size
                end = start + self._sector_size
                difat_chunk = difat_data[start:end]
                if logical_sector + 1 < len(file_sectors):
                    file_sectors[logical_sector + 1][:len(difat_chunk)] = difat_chunk

            if self._mini_fat_sectors:
                minifat_data = self._prepare_minifat()
                for i, logical_sector in enumerate(self._mini_fat_sectors):
                    start = i * self._sector_size
                    end = start + self._sector_size
                    minifat_chunk = minifat_data[start:end]
                    if logical_sector + 1 < len(file_sectors):
                        file_sectors[logical_sector + 1][:len(minifat_chunk)] = minifat_chunk
            
            for sector_data in file_sectors:
                self._file.write(sector_data)

            self._file.flush()
        finally:
            if self._opened:
                self._file.close()

    def _finalize_structure(self):
        """
        Finalize the internal structure before writing to disk.
        This is the original, correct implementation for sector allocation.
        """
        fat_entries_per_sector = self._sector_size // 4
        direct_fat_limit = 109
        difat_refs_per_sector = fat_entries_per_sector - 1

        fat_sectors_needed = 0
        difat_sectors_needed = 0
        iteration = 0
        while True:
            iteration += 1
            if iteration > 20:
                self.logger.error("Stabilization loop exceeded 20 iterations, stopping")
                break
            
            filtered_streams = [s for s in self._all_streams if s.name != 'MiniStream']
            mini_streams = [e for e in filtered_streams if 0 < e.size < self._mini_size_limit]
            normal_streams = [e for e in filtered_streams if e.size >= self._mini_size_limit]

            total_normal_data_size = sum(e.size for e in normal_streams)
            normal_sectors_needed = (total_normal_data_size + self._sector_size - 1) // self._sector_size

            total_mini_sectors_needed = sum((e.size + self._mini_sector_size - 1) // self._mini_sector_size for e in mini_streams)
            mini_storage_size = total_mini_sectors_needed * self._mini_sector_size
            mini_storage_sectors_needed = (mini_storage_size + self._sector_size - 1) // self._sector_size if mini_storage_size > 0 else 0
            
            minifat_sectors_needed = (total_mini_sectors_needed * 4 + self._sector_size - 1) // self._sector_size if total_mini_sectors_needed > 0 else 0
            
            data_sectors_needed = normal_sectors_needed + mini_storage_sectors_needed
            
            total_entities = len(filtered_streams) + len(self._all_storages)
            dir_sectors_needed = (total_entities * DIR_HEADER.size + self._sector_size - 1) // self._sector_size

            total_logical_sectors = dir_sectors_needed + data_sectors_needed + minifat_sectors_needed + fat_sectors_needed + difat_sectors_needed
            
            new_fat_sectors = (total_logical_sectors + fat_entries_per_sector - 1) // fat_entries_per_sector
            
            if new_fat_sectors > direct_fat_limit:
                additional_fat_sectors = new_fat_sectors - direct_fat_limit
                new_difat_sectors = (additional_fat_sectors + difat_refs_per_sector - 1) // difat_refs_per_sector
            else:
                new_difat_sectors = 0
            
            if new_fat_sectors == fat_sectors_needed and new_difat_sectors == difat_sectors_needed:
                break
            
            fat_sectors_needed = new_fat_sectors
            difat_sectors_needed = new_difat_sectors

        current_sector = 0
        
        self._dir_sectors = list(range(current_sector, current_sector + dir_sectors_needed))
        current_sector += dir_sectors_needed

        filtered_streams = [s for s in self._all_streams if s.name != 'MiniStream']
        mini_streams = [e for e in filtered_streams if 0 < e.size < self._mini_size_limit]
        normal_streams = [e for e in filtered_streams if e.size >= self._mini_size_limit]

        for entity in normal_streams:
            sectors_needed = (entity.size + self._sector_size - 1) // self._sector_size
            entity.sector_chain = list(range(current_sector, current_sector + sectors_needed))
            entity.start_sector = entity.sector_chain[0] if entity.sector_chain else END_OF_CHAIN
            current_sector += sectors_needed

        self._mini_stream_sectors = []
        current_mini_sector_idx = 0
        for entity in mini_streams:
            sectors_needed = (entity.size + self._mini_sector_size - 1) // self._mini_sector_size
            entity.mini_sector_chain = list(range(current_mini_sector_idx, current_mini_sector_idx + sectors_needed))
            self._mini_stream_sectors.extend(entity.mini_sector_chain)
            entity.start_sector = entity.mini_sector_chain[0]
            current_mini_sector_idx += sectors_needed
            
        for entity in [e for e in filtered_streams if e.size == 0]:
            entity.start_sector = END_OF_CHAIN
            entity.sector_chain = []
            entity.mini_sector_chain = []

        total_mini_sectors = current_mini_sector_idx
        mini_storage_size = total_mini_sectors * self._mini_sector_size
        mini_storage_sectors_needed = (mini_storage_size + self._sector_size - 1) // self._sector_size if mini_storage_size > 0 else 0
        
        self._mini_storage_sectors = list(range(current_sector, current_sector + mini_storage_sectors_needed))
        current_sector += mini_storage_sectors_needed
        
        minifat_sectors_needed = (total_mini_sectors * 4 + self._sector_size - 1) // self._sector_size if total_mini_sectors > 0 else 0
        self._mini_fat_sectors = list(range(current_sector, current_sector + minifat_sectors_needed))
        current_sector += minifat_sectors_needed
        self._mini_fat_start_sector = self._mini_fat_sectors[0] if self._mini_fat_sectors else END_OF_CHAIN

        self._fat_sectors = list(range(current_sector, current_sector + fat_sectors_needed))
        current_sector += fat_sectors_needed

        self._difat_sectors = list(range(current_sector, current_sector + difat_sectors_needed))
        current_sector += difat_sectors_needed
        
        self._dir_start_sector = self._dir_sectors[0] if self._dir_sectors else END_OF_CHAIN

        if total_mini_sectors > 0:
            self.root.start_sector = self._mini_storage_sectors[0] if self._mini_storage_sectors else END_OF_CHAIN
            self.root.size = mini_storage_size
        else:
            self.root.start_sector = END_OF_CHAIN
            self.root.size = 0

        self._logical_sector_count = current_sector
        self._normal_fat = array('I', [FREE_SECTOR] * self._logical_sector_count)
        
        for chain in [self._dir_sectors, self._mini_storage_sectors, self._mini_fat_sectors]:
            for i, sector in enumerate(chain):
                self._normal_fat[sector] = chain[i + 1] if i < len(chain) - 1 else END_OF_CHAIN

        for entity in normal_streams:
            for i, sector in enumerate(entity.sector_chain):
                self._normal_fat[sector] = entity.sector_chain[i + 1] if i < len(entity.sector_chain) - 1 else END_OF_CHAIN
            
        for sector in self._fat_sectors: self._normal_fat[sector] = FATSECT
        for sector in self._difat_sectors: self._normal_fat[sector] = DIFSECT

    def _prepare_minifat(self):
        """Prepares the MiniFAT data."""
        if not self._mini_stream_sectors: return b''

        max_mini_sector_index = max(self._mini_stream_sectors) if self._mini_stream_sectors else -1
        total_minifat_entries = max_mini_sector_index + 1
        minifat_array = array('I', [FREE_SECTOR] * total_minifat_entries)
        
        filtered_streams = [s for s in self._all_streams if s.name != 'MiniStream']
        mini_streams = [e for e in filtered_streams if 0 < e.size < self._mini_size_limit]

        for entity in mini_streams:
            for i, mini_sector in enumerate(entity.mini_sector_chain):
                minifat_array[mini_sector] = entity.mini_sector_chain[i+1] if i < len(entity.mini_sector_chain) - 1 else END_OF_CHAIN

        minifat_data = minifat_array.tobytes()
        expected_size = len(self._mini_fat_sectors) * self._sector_size
        if len(minifat_data) < expected_size:
            minifat_data += struct.pack('<L', FREE_SECTOR) * ((expected_size - len(minifat_data)) // 4)

        return minifat_data

    def _prepare_header(self):
        """Prepares the compound file header data."""
        dll_version = 3
        minor_version = 0x3E
        bom = 0xFFFE
        
        master_sector_count = len(self._difat_sectors)
        master_first_sector = self._difat_sectors[0] if self._difat_sectors else END_OF_CHAIN

        header_fields = COMPOUND_HEADER.pack(
            COMPOUND_MAGIC, b'\0' * 16, minor_version, dll_version, bom,
            (self._sector_size - 1).bit_length(), (self._mini_sector_size - 1).bit_length(),
            b'\0' * 6, 0, len(self._fat_sectors),
            self._dir_start_sector, 0, self._mini_size_limit,
            self._mini_fat_start_sector, len(self._mini_fat_sectors),
            master_first_sector, master_sector_count
        )
        
        difat_entries = self._fat_sectors[:109]
        difat_entries.extend([FREE_SECTOR] * (109 - len(difat_entries)))
        
        full_header = header_fields + struct.pack('<109L', *difat_entries)
        full_header += b'\0' * (self._sector_size - len(full_header))
        return full_header

    def _prepare_directory(self):
        """
        Prepare the directory entries data using a compliant Red-Black tree.
        """
        # CRITICAL FIX: Exclude MiniStream from the directory entries
        filtered_streams = [s for s in self._all_streams if s.name != 'MiniStream']
        all_entities = [self.root] + [s for s in self._all_storages if s is not self.root] + filtered_streams
        dir_data = bytearray()
        
        entity_to_index = {entity: idx for idx, entity in enumerate(all_entities)}
        
        final_left_siblings = [NO_STREAM] * len(all_entities)
        final_right_siblings = [NO_STREAM] * len(all_entities)
        final_children = [NO_STREAM] * len(all_entities)
        final_colors = [RedBlackTree.COLOR_BLACK] * len(all_entities)

        # CORRECTED traversal function
        def _traverse_and_record_links(node, tree):
            if node is None or node == tree.TNULL:
                return
            
            idx = node.entity_index
            final_left_siblings[idx] = node.left.entity_index if node.left != tree.TNULL else NO_STREAM
            final_right_siblings[idx] = node.right.entity_index if node.right != tree.TNULL else NO_STREAM
            final_colors[idx] = node.color

            _traverse_and_record_links(node.left, tree)
            _traverse_and_record_links(node.right, tree)

        def _build_tree_for_children(parent_entity, parent_idx):
            child_entities = list(parent_entity.children.values())
            
            if not child_entities:
                final_children[parent_idx] = NO_STREAM
                return

            rbtree = RedBlackTree()
            for child in child_entities:
                child_idx = entity_to_index[child]
                rbtree.insert(child, child_idx)
            
            if rbtree.root != rbtree.TNULL:
                final_children[parent_idx] = rbtree.root.entity_index
                # Call the corrected traversal function
                _traverse_and_record_links(rbtree.root, rbtree)
            else:
                final_children[parent_idx] = NO_STREAM

            for child_entity in child_entities:
                if child_entity.entity_type == DIR_STORAGE:
                    child_idx = entity_to_index[child_entity]
                    _build_tree_for_children(child_entity, child_idx)

        root_idx = entity_to_index[self.root]
        _build_tree_for_children(self.root, root_idx)

        for i, entity in enumerate(all_entities):
            if entity.entity_type == DIR_STREAM:
                final_children[i] = NO_STREAM

        for i, entity in enumerate(all_entities):
            entry_data = self._serialize_directory_entry(
                entity, i, final_left_siblings[i], final_right_siblings[i],
                final_children[i], final_colors[i]
            )
            dir_data.extend(entry_data)
        
        padding_needed = (len(self._dir_sectors) * self._sector_size) - len(dir_data)
        if padding_needed > 0: dir_data.extend(b'\0' * padding_needed)

        return dir_data
    
    def _serialize_directory_entry(self, entity, index, left_sibling, right_sibling, child, color_flag):
        """Serialize a directory entry to bytes."""
        name_utf16 = entity.name.encode('utf-16le')
        name_with_null = name_utf16 + b'\x00\x00'
        name_len = len(name_with_null)
        if name_len > 64:
            name_with_null = name_with_null[:62] + b'\x00\x00'
            name_len = 64
        padded_name = name_with_null.ljust(64, b'\0')

        creation_time = modification_time = 0
        if entity.entity_type == DIR_STORAGE:
            FIXED_FILETIME = 0x01CEC6FD605BCC00
            creation_time = modification_time = FIXED_FILETIME

        if entity.size > 0x80000000 and self._dll_version == 3:
            raise ValueError(f"Stream '{entity.name}' size exceeds 2GB limit for version 3.")

        if entity.entity_type == DIR_STREAM:
            child = NO_STREAM  # Streams cannot have children
        if entity.entity_type == DIR_ROOT:
            left_sibling = right_sibling = NO_STREAM  # Root cannot have siblings

        return DIR_HEADER.pack(
            padded_name, name_len, entity.entity_type, color_flag,
            left_sibling, right_sibling, child, b'\0' * 16, 0,
            creation_time, modification_time, entity.start_sector,
            entity.size & 0xFFFFFFFF, (entity.size >> 32) & 0xFFFFFFFF
        )

    def _prepare_data(self):
        """Prepare the actual data for streams."""
        sector_to_data = {}
        
        filtered_streams = [s for s in self._all_streams if s.name != 'MiniStream']
        mini_streams = [e for e in filtered_streams if 0 < e.size < self._mini_size_limit]
        normal_streams = [e for e in filtered_streams if e.size >= self._mini_size_limit]

        if self._mini_stream_sectors:
            total_mini_sectors = sum((e.size + self._mini_sector_size - 1) // self._mini_sector_size for e in mini_streams)
            mini_stream_data = bytearray(total_mini_sectors * self._mini_sector_size)

            for entity in mini_streams:
                for i, mini_sector_idx in enumerate(entity.mini_sector_chain):
                    data_start = i * self._mini_sector_size
                    data_end = min(data_start + self._mini_sector_size, entity.size)
                    chunk = entity.data[data_start:data_end]
                    
                    start_pos = mini_sector_idx * self._mini_sector_size
                    mini_stream_data[start_pos:start_pos + len(chunk)] = chunk

            for i, storage_sector in enumerate(self._mini_storage_sectors):
                start_offset = i * self._sector_size
                end_offset = min(start_offset + self._sector_size, len(mini_stream_data))
                sector_data = mini_stream_data[start_offset:end_offset]
                sector_data += b'\0' * (self._sector_size - len(sector_data))
                sector_to_data[storage_sector] = sector_data

        for entity in normal_streams:
            for i, physical_sector in enumerate(entity.sector_chain):
                start_byte = i * self._sector_size
                end_byte = min(start_byte + self._sector_size, entity.size)
                chunk = entity.data[start_byte:end_byte]
                chunk += b'\0' * (self._sector_size - len(chunk))
                sector_to_data[physical_sector] = chunk

        return sector_to_data

    def _prepare_fat(self):
        """Prepare the File Allocation Table (FAT) data."""
        fat_data = self._normal_fat.tobytes()
        expected_size = len(self._fat_sectors) * self._sector_size
        if len(fat_data) < expected_size:
            padding_count = (expected_size - len(fat_data)) // 4
            fat_data += struct.pack('<%dL' % padding_count, *([FREE_SECTOR] * padding_count))
        return fat_data
        
    def _prepare_difat(self):
        """Prepare the Double Indirect File Allocation Table (DIFAT) data."""
        all_difat_data = bytearray()
        fat_entries_per_sector = self._sector_size // 4
        difat_refs_per_sector = fat_entries_per_sector - 1
        
        if len(self._fat_sectors) <= 109:
            return b'\0' * (len(self._difat_sectors) * self._sector_size)

        additional_fat_sectors = self._fat_sectors[109:]
        
        for i, difat_sector in enumerate(self._difat_sectors):
            start_idx = i * difat_refs_per_sector
            end_idx = start_idx + difat_refs_per_sector
            
            sector_refs = additional_fat_sectors[start_idx:end_idx]
            sector_refs.extend([FREE_SECTOR] * (difat_refs_per_sector - len(sector_refs)))
            
            next_difat = self._difat_sectors[i + 1] if i < len(self._difat_sectors) - 1 else END_OF_CHAIN
            sector_refs.append(next_difat)
            
            all_difat_data.extend(struct.pack(f'<{fat_entries_per_sector}L', *sector_refs))
            
        return all_difat_data

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()


class CompoundFileEntity(object):
    """Represents an entity (stream or storage) in an OLE Compound Document."""
    def __init__(self, name, entity_type, size, start_sector):
        self.name = name
        self.entity_type = entity_type
        self.size = size
        self.start_sector = start_sector
        self.children = OrderedDict()
        self.created = dt.datetime.now()
        self.modified = dt.datetime.now()
        self.data = None
        self.left_sibling = NO_STREAM
        self.right_sibling = NO_STREAM

    def add_child(self, child):
        if self.entity_type not in (DIR_STORAGE, DIR_ROOT):
            raise CompoundFileError("Only storage entities can have children")
        self.children[child.name] = child

    @property
    def isfile(self): return self.entity_type == DIR_STREAM
    @property
    def isdir(self): return self.entity_type in (DIR_STORAGE, DIR_ROOT)


class FatAllocator:
    """Manages allocation and deallocation of sectors in a FAT array."""
    def __init__(self, fat_array):
        self.fat = fat_array
        self.free_sectors = [i for i, entry in enumerate(self.fat) if entry == FREE_SECTOR]

    def allocate_chain(self, num_sectors):
        if len(self.free_sectors) < num_sectors: return END_OF_CHAIN
        self.free_sectors.sort()
        chain_sectors = [self.free_sectors.pop(0) for _ in range(num_sectors)]
        for i, sector in enumerate(chain_sectors):
            self.fat[sector] = chain_sectors[i + 1] if i < len(chain_sectors) - 1 else END_OF_CHAIN
        return chain_sectors[0]

    def allocate_single(self):
        if not self.free_sectors: return END_OF_CHAIN
        sector = self.free_sectors.pop(0)
        self.fat[sector] = END_OF_CHAIN
        return sector

    def free_chain(self, start_sector):
        current = start_sector
        while current != END_OF_CHAIN and current < len(self.fat):
            next_sector = self.fat[current]
            self.fat[current] = FREE_SECTOR
            self.free_sectors.append(current)
            current = next_sector