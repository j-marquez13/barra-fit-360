const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'controllers', 'inventoryController.js');

const code = `
export async function deleteProducto(req, res) {
  try {
    const { id } = req.params;
    const result = await db.execute('UPDATE productos SET activo = 0 WHERE id = $1', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    return res.json({ mensaje: 'Producto eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

export async function deleteInsumo(req, res) {
  try {
    const { id } = req.params;
    const result = await db.execute('DELETE FROM insumos WHERE id = $1', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado' });
    return res.json({ mensaje: 'Insumo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar insumo:', error);
    return res.status(500).json({ error: 'No se pudo eliminar el insumo. Verifica que no esté en uso.' });
  }
}
`;
fs.appendFileSync(p, code);
