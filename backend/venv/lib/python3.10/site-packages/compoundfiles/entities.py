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
# This file contains modified code for compound file entities.

from __future__ import (
    unicode_literals,
    absolute_import,
    print_function,
    division,
    )
str = type('')


import warnings
import datetime as dt
from pprint import pformat

from compoundfiles.errors import (
    CompoundFileDirLoopError,
    CompoundFileDirEntryWarning,
    CompoundFileDirNameWarning,
    CompoundFileDirTypeWarning,
    CompoundFileDirIndexWarning,
    CompoundFileDirTimeWarning,
    CompoundFileDirSectorWarning,
    CompoundFileDirSizeWarning,
    )
from compoundfiles.const import (
    NO_STREAM,
    DIR_INVALID,
    DIR_STORAGE,
    DIR_STREAM,
    DIR_ROOT,
    DIR_HEADER,
    FILENAME_ENCODING,
    )


class CompoundFileEntity(object):
    """
    Represents an entity in an OLE Compound Document.

    An entity in an OLE Compound Document can be a "stream" (analogous to a
    file in a file-system) which has a :attr:`size` and can be opened by a call
    to the parent object's :meth:`~CompoundFileReader.open` method.
    Alternatively, it can be a "storage" (analogous to a directory in a
    file-system), which has no size but has :attr:`created` and
    :attr:`modified` time-stamps, and can contain other streams and storages.

    If the entity is a storage, it will act as an iterable read-only sequence,
    indexable by ordinal or by name, and compatible with the ``in`` operator
    and built-in :func:`len` function.

    .. attribute:: created

        For storage entities (where :attr:`isdir` is ``True``), this returns
        the creation date of the storage. Returns ``None`` for stream entities.

    .. attribute:: isdir

        Returns True if this is a storage entity which can contain other
        entities.

    .. attribute:: isfile

        Returns True if this is a stream entity which can be opened.

    .. attribute:: modified

        For storage entities (where :attr:`isdir` is True), this returns the
        last modification date of the storage. Returns ``None`` for stream
        entities.

    .. attribute:: name

        Returns the name of entity. This can be up to 31 characters long and
        may contain any character representable in UTF-16 except the NULL
        character. Names are considered case-insensitive for comparison
        purposes.

    .. attribute:: size

        For stream entities (where :attr:`isfile` is ``True``), this returns
        the number of bytes occupied by the stream. Returns 0 for storage
        entities.
    """

    def __init__(self, parent, stream, index):
        super(CompoundFileEntity, self).__init__()
        self._index = index
        self._children = []  # Initialize as empty list instead of None
        (
            name,
            name_len,
            self._entry_type,
            self._entry_color,
            self._left_index,
            self._right_index,
            self._child_index,
            self.uuid,
            user_flags,
            created,
            modified,
            self._start_sector,
            size_low,
            size_high,
        ) = DIR_HEADER.unpack(stream.read(DIR_HEADER.size))
        self.name = name.decode('utf-16le')
        try:
            self.name = self.name[:self.name.index('\0')]
        except ValueError:
            warnings.warn(
                CompoundFileDirNameWarning(
                    'missing NULL terminator in name'))
            self.name = self.name[:(name_len // 2) - 1]
        if index == 0:
            if self._entry_type != DIR_ROOT:
                warnings.warn(
                    CompoundFileDirTypeWarning('invalid type'))
            self._entry_type = DIR_ROOT
        elif not self._entry_type in (DIR_STREAM, DIR_STORAGE, DIR_INVALID):
            warnings.warn(
                CompoundFileDirTypeWarning('invalid type'))
            self._entry_type = DIR_INVALID
        if self._entry_type == DIR_INVALID:
            if self.name != '':
                warnings.warn(
                    CompoundFileDirNameWarning('non-empty name'))
            if name_len != 0:
                warnings.warn(
                    CompoundFileDirNameWarning('non-zero name length'))
            if user_flags != 0:
                warnings.warn(
                    CompoundFileDirEntryWarning('non-zero user flags'))
        else:
            # Name length is in bytes, including NULL terminator ... for a
            # unicode encoded name ... *headdesk*
            if (len(self.name) + 1) * 2 != name_len:
                warnings.warn(
                    CompoundFileDirNameWarning('invalid name length (%d)' % name_len))
        # According to OLE specification, for ROOT entries:
        # left and right siblings should be NO_STREAM as root cannot have siblings
        # For STREAM entries: child should be NO_STREAM as streams cannot have children
        # Check for invalid UUID (should be zero except for special cases)
        # Only warn for entries that have both non-zero UUID and problematic timestamps
        has_problematic_timestamps = (created != 0 and (created < 10000000 or created > 999999999999999999)) or \
                                   (modified != 0 and (modified < 10000000 or modified > 999999999999999999))
        if self._entry_type != DIR_ROOT and self.uuid != b'\0' * 16 and has_problematic_timestamps:
            warnings.warn(
                CompoundFileDirEntryWarning('non-zero UUID with invalid timestamps'))

        if self._entry_type == DIR_ROOT:
            if self._left_index != NO_STREAM:
                warnings.warn(
                    CompoundFileDirIndexWarning('invalid left sibling'))
            if self._right_index != NO_STREAM:
                warnings.warn(
                    CompoundFileDirIndexWarning('invalid right sibling'))
            self._left_index = NO_STREAM
            self._right_index = NO_STREAM
        elif self._entry_type == DIR_INVALID:
            # For invalid entries, still warn and reset
            if self._left_index != NO_STREAM:
                warnings.warn(
                    CompoundFileDirIndexWarning('invalid left sibling'))
            if self._right_index != NO_STREAM:
                warnings.warn(
                    CompoundFileDirIndexWarning('invalid right sibling'))
            self._left_index = NO_STREAM
            self._right_index = NO_STREAM

        if self._entry_type == DIR_STREAM:
            if self._child_index != NO_STREAM:
                warnings.warn(
                    CompoundFileDirIndexWarning('invalid child index'))
            self._child_index = NO_STREAM
        elif self._entry_type == DIR_INVALID:
            # For invalid entries, still warn and reset
            if self._child_index != NO_STREAM:
                warnings.warn(
                    CompoundFileDirIndexWarning('invalid child index'))
            self._child_index = NO_STREAM
            self.uuid = b'\0' * 16
            created = 0
            modified = 0
        if self._entry_type in (DIR_INVALID, DIR_STORAGE):
            if self._start_sector != 0:
                warnings.warn(
                    CompoundFileDirSectorWarning(
                        'non-zero start sector (%d)' % self._start_sector))
            if size_low != 0:
                warnings.warn(
                    CompoundFileDirSizeWarning(
                        'non-zero size low-bits (%d)' % size_low))
            if size_high != 0:
                warnings.warn(
                    CompoundFileDirSizeWarning(
                        'non-zero size high-bits (%d)' % size_high))
            self._start_sector = 0
            size_low = 0
            size_high = 0
        if parent._normal_sector_size == 512:
            # Surely this should be checking DLL version instead of sector
            # size?! But the spec does state sector size ...
            if size_high != 0:
                warnings.warn(
                    CompoundFileDirSizeWarning(
                        'invalid size in small sector file'))
                size_high = 0
            if size_low >= 1<<31:
                warnings.warn(
                    CompoundFileDirSizeWarning(
                        'size too large for small sector file'))
        self.size = (size_high << 32) | size_low
        epoch = dt.datetime(1601, 1, 1)
        # Check for invalid timestamps (for corrupted files)
        # Issue warnings for clearly invalid timestamp values
        # Very large or very small timestamp values might indicate corruption
        if created != 0 and (created < 10000000 or created > 999999999999999999):
            warnings.warn(
                CompoundFileDirTimeWarning('invalid creation timestamp value'))
        if modified != 0 and (modified < 10000000 or modified > 999999999999999999):
            warnings.warn(
                CompoundFileDirTimeWarning('invalid modification timestamp value'))

        self.created = (
                epoch + dt.timedelta(microseconds=created // 10)
                if created != 0 else None)
        self.modified = (
                epoch + dt.timedelta(microseconds=modified // 10)
                if modified != 0 else None)

    @property
    def isfile(self):
        return self._entry_type == DIR_STREAM

    @property
    def isdir(self):
        return self._entry_type in (DIR_STORAGE, DIR_ROOT)

    def _build_tree(self, entries):
        # Reset children to empty list to ensure it's always a list
        self._children = []

        def walk(index):
            if index == NO_STREAM:
                return
            try:
                node = entries[index]
            except IndexError:
                warnings.warn(CompoundFileDirIndexWarning(
                    'invalid index (%d) in entry at index %d' % (index, self._index if hasattr(self, '_index') else -1)))
                return
            if node is None:
                # This can happen if we have a loop in the tree
                raise CompoundFileDirLoopError(
                    'loop detected in directory hierarchy (points to index %d)' % index)
            entries[index] = None  # Mark as visited to prevent infinite loops

            # Process left subtree
            if node._left_index != NO_STREAM:
                try:
                    walk(node._left_index)
                except IndexError:
                    warnings.warn(CompoundFileDirIndexWarning(
                        'invalid left index (%d) in entry at index %d' % (node._left_index, index)))

            self._children.append(node)

            # Process right subtree
            if node._right_index != NO_STREAM:
                try:
                    walk(node._right_index)
                except IndexError:
                    warnings.warn(CompoundFileDirIndexWarning(
                        'invalid right index (%d) in entry at index %d' % (node._right_index, index)))

            # Recursively build children of this node
            if node.isdir and node._child_index != NO_STREAM:
                try:
                    node._build_tree(entries)
                except IndexError:
                    warnings.warn(CompoundFileDirIndexWarning(
                        'invalid child index in entry at index %d' % index))

        if self.isdir:
            try:
                walk(self._child_index)
            except IndexError:
                if self._child_index != NO_STREAM:
                    warnings.warn(CompoundFileDirIndexWarning(
                        'invalid child index'))

    def __len__(self):
        return len(self._children)

    def __iter__(self):
        return iter(self._children)

    def __contains__(self, name_or_obj):
        if isinstance(name_or_obj, bytes):
            name_or_obj = name_or_obj.decode(FILENAME_ENCODING)
        if isinstance(name_or_obj, str):
            try:
                self.__getitem__(name_or_obj)
                return True
            except KeyError:
                return False
        else:
            return name_or_obj in self._children

    def __getitem__(self, index_or_name):
        if isinstance(index_or_name, bytes):
            index_or_name = index_or_name.decode(FILENAME_ENCODING)
        if isinstance(index_or_name, str):
            name = index_or_name.lower()
            for item in self._children:
                if item.name.lower() == name:
                    return item
            # Если не найден, пробуем найти по точному совпадению (без tolower)
            for item in self._children:
                if item.name == index_or_name:
                    return item
            raise KeyError(index_or_name)
        else:
            return self._children[index_or_name]

    def __repr__(self):
        return (
            "<CompoundFileEntity name='%s'>" % self.name
            if self.isfile else
            pformat([
                "<CompoundFileEntity dir='%s'>" % c.name
                if c.isdir else
                repr(c)
                for c in self._children
                ])
            if self.isdir else
            "<CompoundFileEntry ???>"
            )

