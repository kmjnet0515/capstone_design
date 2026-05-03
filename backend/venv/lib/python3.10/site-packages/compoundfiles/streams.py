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
# This file contains modified code for compound file streams.

from __future__ import (
    unicode_literals,
    absolute_import,
    print_function,
    division,
    )
native_str = str
str = type('')


import io
import warnings
from array import array
from abc import abstractmethod

from compoundfiles.errors import (
    CompoundFileNoMiniFatError,
    CompoundFileNormalLoopError,
    CompoundFileDirSizeWarning,
    CompoundFileTruncatedWarning,
    )
from compoundfiles.const import END_OF_CHAIN, FREE_SECTOR


class CompoundFileStream(io.RawIOBase):
    """
    Abstract base class for streams within an OLE Compound Document.

    Instances of :class:`CompoundFileStream` are not constructed
    directly, but are returned by the :meth:`CompoundFileReader.open` method.
    They support all common methods associated with read-only streams
    (:meth:`read`, :meth:`seek`, :meth:`tell`, and so forth).
    """
    def __init__(self):
        super(CompoundFileStream, self).__init__()
        self._sectors = array(native_str('L'))
        self._sector_index = None
        self._sector_offset = None
        self._truncation_reported = False  # Flag to track if truncation warning was already issued

    def _load_sectors(self, start, fat):
        # To guard against cyclic FAT chains we use the tortoise'n'hare
        # algorithm here. If hare is ever equal to tortoise after a step, then
        # the hare somehow got transported behind the tortoise (via a loop) so
        # we raise an error
        hare = start
        tortoise = start

        # Check if start is a valid sector
        if start == END_OF_CHAIN or start == FREE_SECTOR:
            return

        # Check if start is a valid index in the FAT array
        if start >= len(fat):
            raise IndexError(f"invalid sector index in FAT: start={start}, len(fat)={len(fat)}")

        # Check if start is a special value that shouldn't be in the middle of a chain
        if start in (END_OF_CHAIN, FREE_SECTOR):
            return

        while tortoise != END_OF_CHAIN:
            self._sectors.append(tortoise)

            # Check if tortoise is a valid index in the FAT array
            if tortoise >= len(fat):
                raise IndexError(f"invalid sector index in FAT: tortoise={tortoise}, len(fat)={len(fat)}")

            next_tortoise = fat[tortoise]
            # Check if the next value is a special value
            if next_tortoise in (END_OF_CHAIN, FREE_SECTOR):
                break
            elif next_tortoise >= len(fat):
                # If the next value is out of bounds, treat it as END_OF_CHAIN
                # This handles cases where corrupted files have invalid sector numbers
                break

            tortoise = next_tortoise

            # Tortoise'n'hare algorithm for loop detection
            if hare != END_OF_CHAIN:
                # Check if hare is a valid index in the FAT array
                if hare >= len(fat):
                    raise IndexError(f"invalid sector index in FAT: hare={hare}, len(fat)={len(fat)}")

                next_hare = fat[hare]
                # Check if the next value is a special value
                if next_hare in (END_OF_CHAIN, FREE_SECTOR):
                    hare = next_hare
                elif next_hare >= len(fat):
                    # If the next value is out of bounds, treat it as END_OF_CHAIN
                    hare = END_OF_CHAIN
                else:
                    hare = next_hare

                if hare != END_OF_CHAIN:
                    # Check if hare is a valid index in the FAT array
                    if hare >= len(fat):
                        raise IndexError(f"invalid sector index in FAT: hare={hare}, len(fat)={len(fat)}")

                    next_hare = fat[hare]
                    # Check if the next value is a special value
                    if next_hare in (END_OF_CHAIN, FREE_SECTOR):
                        hare = next_hare
                    elif next_hare >= len(fat):
                        # If the next value is out of bounds, treat it as END_OF_CHAIN
                        hare = END_OF_CHAIN
                    else:
                        hare = next_hare

                    if hare == tortoise and hare != END_OF_CHAIN:
                        raise CompoundFileNormalLoopError(
                                'cyclic FAT chain found starting at %d' % start)

    @abstractmethod
    def _set_pos(self, value):
        raise NotImplementedError

    def readable(self):
        """
        Returns ``True``, indicating that the stream supports :meth:`read`.
        """
        return True

    def writable(self):
        """
        Returns ``False``, indicating that the stream doesn't support
        :meth:`write` or :meth:`truncate`.
        """
        return False

    def seekable(self):
        """
        Returns ``True``, indicating that the stream supports :meth:`seek`.
        """
        return True

    def tell(self):
        """
        Return the current stream position.
        """
        return (self._sector_index * self._sector_size) + self._sector_offset

    def seek(self, offset, whence=io.SEEK_SET):
        """
        Change the stream position to the given byte *offset*. *offset* is
        interpreted relative to the position indicated by *whence*. Values for
        *whence* are:

        * ``SEEK_SET`` or ``0`` - start of the stream (the default); *offset*
          should be zero or positive

        * ``SEEK_CUR`` or ``1`` - current stream position; *offset* may be
          negative

        * ``SEEK_END`` or ``2`` - end of the stream; *offset* is usually
          negative

        Return the new absolute position.
        """
        if whence == io.SEEK_CUR:
            offset = self.tell() + offset
        elif whence == io.SEEK_END:
            offset = self._length + offset
        if offset < 0:
            raise ValueError(
                    'New position is before the start of the stream')
        self._set_pos(offset)
        return offset

    @abstractmethod
    def read1(self, n=-1):
        """
        Read up to *n* bytes from the stream using only a single call to the
        underlying object.

        In the case of :class:`CompoundFileStream` this roughly corresponds to
        returning the content from the current position up to the end of the
        current sector.
        """
        raise NotImplementedError

    def read(self, n=-1):
        """
        Read up to *n* bytes from the stream and return them. As a convenience,
        if *n* is unspecified or -1, :meth:`readall` is called. Fewer than *n*
        bytes may be returned if there are fewer than *n* bytes from the
        current stream position to the end of the stream.

        If 0 bytes are returned, and *n* was not 0, this indicates end of the
        stream.
        """
        if n == -1:
            n = max(0, self._length - self.tell())
        else:
            n = max(0, min(n, self._length - self.tell()))
        result = bytearray(n)
        i = 0
        while i < n:
            buf = self.read1(n - i)
            if not buf:
                if not self._truncation_reported:
                    warnings.warn(
                        CompoundFileTruncatedWarning(
                            'compound document appears to be truncated'))
                    self._truncation_reported = True
                break
            result[i:i + len(buf)] = buf
            i += len(buf)
        return bytes(result)


class CompoundFileNormalStream(CompoundFileStream):
    def __init__(self, parent, start, length=None):
        super(CompoundFileNormalStream, self).__init__()
        self._load_sectors(start, parent._normal_fat)
        self._sector_size = parent._normal_sector_size
        self._header_size = parent._header_size
        self._mmap = parent._mmap
        min_length = (len(self._sectors) - 1) * self._sector_size
        max_length = len(self._sectors) * self._sector_size
        if length is None:
            self._length = max_length
        elif not (min_length <= length <= max_length):
            # If the length exceeds max_length, it means the stream extends beyond available sectors
            # This indicates a truncated file condition
            if length > max_length:
                warnings.warn(
                    CompoundFileTruncatedWarning(
                        'stream at sector %d extends beyond available sectors (claimed: %d, available: %d)' %
                        (start, length, max_length)))
                self._truncation_reported = True  # Mark that truncation was reported
            else:
                warnings.warn(
                    CompoundFileDirSizeWarning(
                        'length (%d) of stream at sector %d exceeds bounds '
                        '(%d-%d)' % (length, start, min_length, max_length)))
            self._length = max_length
        else:
            self._length = length
        self._set_pos(0)

    def close(self):
        self._mmap = None

    def _set_pos(self, value):
        self._sector_index = value // self._sector_size
        self._sector_offset = value % self._sector_size

    def read1(self, n=-1):
        if n == -1:
            n = max(0, self._length - self.tell())
        else:
            n = max(0, min(n, self._length - self.tell()))
        n = min(n, self._sector_size - self._sector_offset)
        if n == 0:
            return b''
        offset = (
                self._header_size + (
                self._sectors[self._sector_index] * self._sector_size) +
                self._sector_offset)
        result = self._mmap[offset:offset + n]
        self._set_pos(self.tell() + n)
        return result


class CompoundFileMiniStream(CompoundFileStream):
    def __init__(self, parent, start, length=None):
        super(CompoundFileMiniStream, self).__init__()
        if not parent._mini_fat:
            raise CompoundFileNoMiniFatError(
                'no mini FAT in compound document')
        self._load_sectors(start, parent._mini_fat)
        self._sector_size = parent._mini_sector_size
        self._header_size = 0
        self._file = CompoundFileNormalStream(
                parent, parent.root._start_sector, parent.root.size)
        max_length = len(self._sectors) * self._sector_size
        if length is not None and length > max_length:
            # If the length exceeds max_length, it means the stream extends beyond available sectors
            # This indicates a truncated file condition
            warnings.warn(
                CompoundFileTruncatedWarning(
                    'mini stream at sector %d extends beyond available sectors (claimed: %d, available: %d)' %
                    (start, length, max_length)))
            self._truncation_reported = True  # Mark that truncation was reported
        else:
            # Check if the underlying file stream had truncation reported
            if hasattr(self._file, '_truncation_reported') and self._file._truncation_reported:
                self._truncation_reported = True  # Propagate the truncation flag
        self._length = min(max_length, length or max_length)
        self._set_pos(0)

    def close(self):
        try:
            if hasattr(self, '_file') and self._file is not None:
                self._file.close()
        finally:
            if hasattr(self, '_file'):
                self._file = None

    def _set_pos(self, value):
        self._sector_index = value // self._sector_size
        self._sector_offset = value % self._sector_size
        if self._sector_index < len(self._sectors):
            self._file.seek(
                    self._header_size +
                    (self._sectors[self._sector_index] * self._sector_size) +
                    self._sector_offset)

    def read1(self, n=-1):
        if n == -1:
            n = max(0, self._length - self.tell())
        else:
            n = max(0, min(n, self._length - self.tell()))
        n = min(n, self._sector_size - self._sector_offset)
        if n == 0:
            return b''
        result = self._file.read1(n)
        # Only perform a seek to a different sector if we've crossed into one
        if self._sector_offset + n < self._sector_size:
            self._sector_offset += n
        else:
            self._set_pos(self.tell() + n)
        return result

