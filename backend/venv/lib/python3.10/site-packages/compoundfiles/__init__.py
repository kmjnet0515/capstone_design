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
# This file contains the main module initialization for compound files.

"""
Most of the work in this package was derived from the specification for `OLE
Compound Document`_ files published by OpenOffice, and the specification for
the `Advanced Authoring Format`_ (AAF) published by Microsoft.

.. _OLE Compound Document: http://www.openoffice.org/sc/compdocfileformat.pdf
.. _Advanced Authoring Format: http://www.amwa.tv/downloads/specifications/aafcontainerspec-v1.0.1.pdf


CompoundFileReader
==================

.. autoclass:: CompoundFileReader
    :members:


CompoundFileStream
==================

.. autoclass:: CompoundFileStream
    :members:


CompoundFileEntity
==================

.. autoclass:: CompoundFileEntity
    :members:


Exceptions
==========

.. autoexception:: CompoundFileError

.. autoexception:: CompoundFileWarning

"""

from __future__ import (
    unicode_literals,
    absolute_import,
    print_function,
    division,
    )
str = type('')


from compoundfiles.errors import (
    CompoundFileError,
    CompoundFileHeaderError,
    CompoundFileMasterFatError,
    CompoundFileNormalFatError,
    CompoundFileMiniFatError,
    CompoundFileDirEntryError,
    CompoundFileInvalidMagicError,
    CompoundFileInvalidBomError,
    CompoundFileLargeNormalFatError,
    CompoundFileLargeMiniFatError,
    CompoundFileNoMiniFatError,
    CompoundFileMasterLoopError,
    CompoundFileNormalLoopError,
    CompoundFileDirLoopError,
    CompoundFileNotFoundError,
    CompoundFileNotStreamError,
    CompoundFileWarning,
    CompoundFileHeaderWarning,
    CompoundFileMasterFatWarning,
    CompoundFileNormalFatWarning,
    CompoundFileMiniFatWarning,
    CompoundFileVersionWarning,
    CompoundFileSectorSizeWarning,
    CompoundFileMasterSectorWarning,
    CompoundFileNormalSectorWarning,
    CompoundFileDirEntryWarning,
    CompoundFileDirNameWarning,
    CompoundFileDirTypeWarning,
    CompoundFileDirIndexWarning,
    CompoundFileDirTimeWarning,
    CompoundFileDirSectorWarning,
    CompoundFileDirSizeWarning,
    CompoundFileTruncatedWarning,
    CompoundFileEmulationWarning,
    )
from compoundfiles.streams import CompoundFileStream
from compoundfiles.entities import CompoundFileEntity
from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter
from compoundfiles.editor import CompoundFileEditor

