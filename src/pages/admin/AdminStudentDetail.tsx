import { useParams } from 'react-router-dom'
import { StudentDetailView } from '../shared/StudentDetailView'
import { loadStudentDetail, useLiveData } from './useAdminData'

export default function AdminStudentDetail() {
  const { id = '' } = useParams()
  const { data, error } = useLiveData(() => loadStudentDetail(id), [id])
  return <StudentDetailView data={data} error={error} back={{ to: '/admin', label: 'Back to Student Activity' }} />
}
